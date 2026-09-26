package git

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"

	"github.com/symtab-pkm/server/internal/domain"
)

var (
	ErrNotRepository = errors.New("version control is not enabled for this vault")
	ErrMessageNeeded = errors.New("commit message is required")
	ErrInvalidPath   = errors.New("invalid Git path")
	ErrInvalidRemote = errors.New("invalid remote URL")
)

type CommandError struct{ Message string }

func (e *CommandError) Error() string { return e.Message }

func Status(ctx context.Context, root string) (domain.GitStatus, error) {
	if _, err := exec.LookPath("git"); err != nil {
		return domain.GitStatus{Changes: []domain.GitChange{}}, nil
	}
	status := domain.GitStatus{Available: true, Changes: []domain.GitChange{}, Remotes: []domain.GitRemote{}}
	top, err := run(ctx, root, "rev-parse", "--show-toplevel")
	if err != nil || !samePath(strings.TrimSpace(string(top)), root) {
		return status, nil
	}
	status.Initialized = true
	out, err := run(ctx, root, "status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all", "--", ".", ":(exclude,top).symtab/**")
	if err != nil {
		return domain.GitStatus{}, err
	}
	parseStatus(out, &status)
	status.Remotes, err = Remotes(ctx, root)
	if err != nil {
		return domain.GitStatus{}, err
	}
	for _, remote := range status.Remotes {
		if remote.Name == "origin" {
			status.Origin = remote.URL
			break
		}
	}
	return status, nil
}

func Enable(ctx context.Context, root string) error {
	if err := requireGit(); err != nil {
		return err
	}
	status, err := Status(ctx, root)
	if err != nil {
		return err
	}
	if !status.Initialized {
		if _, err := run(ctx, root, "init"); err != nil {
			return err
		}
	}
	return ensureIgnored(root, ".symtab/")
}

func Stage(ctx context.Context, root string, paths []string) error {
	if err := requireRepository(ctx, root); err != nil {
		return err
	}
	args, err := pathArgs([]string{"add", "-A", "--"}, paths)
	if err != nil {
		return err
	}
	if len(paths) == 0 {
		args = append(args, ".")
	}
	if _, err = run(ctx, root, args...); err != nil || len(paths) != 0 {
		return err
	}
	_, err = run(ctx, root, "rm", "--cached", "-r", "--ignore-unmatch", "--", ".symtab")
	return err
}

func Unstage(ctx context.Context, root string, paths []string) error {
	if err := requireRepository(ctx, root); err != nil {
		return err
	}
	if len(paths) == 0 {
		paths = []string{"."}
	}
	if _, err := run(ctx, root, "rev-parse", "--verify", "HEAD"); err != nil {
		args, pathErr := pathArgs([]string{"rm", "--cached", "-r", "--ignore-unmatch", "--"}, paths)
		if pathErr != nil {
			return pathErr
		}
		_, err = run(ctx, root, args...)
		return err
	}
	args, err := pathArgs([]string{"reset", "--quiet", "HEAD", "--"}, paths)
	if err != nil {
		return err
	}
	_, err = run(ctx, root, args...)
	return err
}

func Commit(ctx context.Context, root, message string, paths []string) error {
	message = strings.TrimSpace(message)
	if message == "" {
		return ErrMessageNeeded
	}
	if len(paths) > 0 {
		if err := Stage(ctx, root, paths); err != nil {
			return err
		}
	} else if err := requireRepository(ctx, root); err != nil {
		return err
	}
	_, err := run(ctx, root, "commit", "-m", message)
	return err
}

func Pull(ctx context.Context, root string) error {
	return repositoryCommand(ctx, root, "pull", "--ff-only")
}

func Push(ctx context.Context, root string) error {
	return PushTo(ctx, root, "")
}

func PushTo(ctx context.Context, root, remote string) error {
	if err := requireRepository(ctx, root); err != nil {
		return err
	}
	status, err := Status(ctx, root)
	if err != nil {
		return err
	}
	remote = strings.TrimSpace(remote)
	if remote != "" {
		if err := validateRemoteName(ctx, root, remote); err != nil {
			return err
		}
		if status.Upstream == "" {
			return repositoryCommand(ctx, root, "push", "-u", remote, "HEAD")
		}
		return repositoryCommand(ctx, root, "push", remote, "HEAD")
	}
	if status.Upstream == "" && status.Origin != "" {
		return repositoryCommand(ctx, root, "push", "-u", "origin", "HEAD")
	}
	return repositoryCommand(ctx, root, "push")
}

func Fetch(ctx context.Context, root string) error {
	return repositoryCommand(ctx, root, "fetch", "--all", "--prune")
}

func Remotes(ctx context.Context, root string) ([]domain.GitRemote, error) {
	out, err := run(ctx, root, "remote")
	if err != nil {
		return nil, err
	}
	remotes := make([]domain.GitRemote, 0)
	for _, name := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if name == "" {
			continue
		}
		url, urlErr := run(ctx, root, "remote", "get-url", name)
		if urlErr != nil {
			return nil, urlErr
		}
		remotes = append(remotes, domain.GitRemote{Name: name, URL: strings.TrimSpace(string(url))})
	}
	return remotes, nil
}

func SetRemote(ctx context.Context, root, name, url string) error {
	if err := requireRepository(ctx, root); err != nil {
		return err
	}
	name = strings.TrimSpace(name)
	url = strings.TrimSpace(url)
	if err := validateRemoteName(ctx, root, name); err != nil {
		return err
	}
	if url == "" || strings.HasPrefix(url, "-") || strings.ContainsRune(url, 0) {
		return ErrInvalidRemote
	}
	if _, err := run(ctx, root, "remote", "get-url", name); err == nil {
		_, err = run(ctx, root, "remote", "set-url", name, url)
		return err
	}
	_, err := run(ctx, root, "remote", "add", name, url)
	return err
}

func RemoveRemote(ctx context.Context, root, name string) error {
	if err := requireRepository(ctx, root); err != nil {
		return err
	}
	name = strings.TrimSpace(name)
	if err := validateRemoteName(ctx, root, name); err != nil {
		return err
	}
	if _, err := run(ctx, root, "remote", "get-url", name); err != nil {
		return nil
	}
	_, err := run(ctx, root, "remote", "remove", name)
	return err
}

func validateRemoteName(ctx context.Context, root, name string) error {
	if name == "" || strings.HasPrefix(name, "-") || strings.ContainsAny(name, " \t\r\n\x00") {
		return ErrInvalidRemote
	}
	if _, err := run(ctx, root, "check-ref-format", "refs/remotes/"+name); err != nil {
		return ErrInvalidRemote
	}
	return nil
}

func Diff(ctx context.Context, root, path string, staged bool) (domain.GitDiff, error) {
	if err := requireRepository(ctx, root); err != nil {
		return domain.GitDiff{}, err
	}
	paths, err := pathArgs(nil, []string{path})
	if err != nil {
		return domain.GitDiff{}, err
	}
	args := []string{"diff", "--no-ext-diff", "--unified=3"}
	if staged {
		args = append(args, "--cached")
	}
	args = append(args, "--")
	args = append(args, paths...)
	out, err := run(ctx, root, args...)
	if err != nil {
		return domain.GitDiff{}, err
	}
	const maxDiffBytes = 1 << 20
	if len(out) > maxDiffBytes {
		out = append(out[:maxDiffBytes], []byte("\n… diff truncated by Symtab\n")...)
	}
	return domain.GitDiff{Path: path, Staged: staged, Content: string(out)}, nil
}

func Discard(ctx context.Context, root string, paths []string) error {
	if err := requireRepository(ctx, root); err != nil {
		return err
	}
	validated, err := pathArgs(nil, paths)
	if err != nil || len(validated) == 0 {
		if err != nil {
			return err
		}
		return ErrInvalidPath
	}
	for _, pathspec := range validated {
		if _, trackedErr := run(ctx, root, "ls-files", "--error-unmatch", "--", pathspec); trackedErr == nil {
			if _, err := run(ctx, root, "restore", "--worktree", "--", pathspec); err != nil {
				return err
			}
		} else if _, err := run(ctx, root, "clean", "-f", "--", pathspec); err != nil {
			return err
		}
	}
	return nil
}

func Branches(ctx context.Context, root string) ([]domain.GitBranch, error) {
	if err := requireRepository(ctx, root); err != nil {
		return nil, err
	}
	current, _ := run(ctx, root, "branch", "--show-current")
	out, err := run(ctx, root, "branch", "--format=%(refname:short)")
	if err != nil {
		return nil, err
	}
	currentName := strings.TrimSpace(string(current))
	branches := make([]domain.GitBranch, 0)
	for _, name := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if name != "" {
			branches = append(branches, domain.GitBranch{Name: name, Current: name == currentName})
		}
	}
	if currentName != "" && !slices.ContainsFunc(branches, func(branch domain.GitBranch) bool { return branch.Name == currentName }) {
		branches = append(branches, domain.GitBranch{Name: currentName, Current: true})
	}
	return branches, nil
}

func Checkout(ctx context.Context, root, branch string, create bool) error {
	if err := requireRepository(ctx, root); err != nil {
		return err
	}
	branch = strings.TrimSpace(branch)
	if branch == "" || strings.HasPrefix(branch, "-") {
		return errors.New("invalid branch name")
	}
	if _, err := run(ctx, root, "check-ref-format", "--branch", branch); err != nil {
		return err
	}
	args := []string{"switch"}
	if create {
		args = append(args, "-c")
	}
	args = append(args, branch)
	_, err := run(ctx, root, args...)
	return err
}

func History(ctx context.Context, root string, limit int) ([]domain.GitCommit, error) {
	if err := requireRepository(ctx, root); err != nil {
		return nil, err
	}
	if _, err := run(ctx, root, "rev-parse", "--verify", "HEAD"); err != nil {
		return []domain.GitCommit{}, nil
	}
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	out, err := run(ctx, root, "log", "-n", strconv.Itoa(limit), "--format=%H%x00%h%x00%an%x00%aI%x00%s%x00")
	if err != nil {
		return nil, err
	}
	fields := bytes.Split(out, []byte{0})
	commits := make([]domain.GitCommit, 0, len(fields)/5)
	for index := 0; index+4 < len(fields); index += 5 {
		hash := strings.TrimSpace(string(fields[index]))
		if hash == "" {
			continue
		}
		commits = append(commits, domain.GitCommit{Hash: hash, ShortHash: string(fields[index+1]), Author: string(fields[index+2]), Date: string(fields[index+3]), Subject: string(fields[index+4])})
	}
	return commits, nil
}

func Resolve(ctx context.Context, root, path, strategy string) error {
	if err := requireRepository(ctx, root); err != nil {
		return err
	}
	paths, err := pathArgs(nil, []string{path})
	if err != nil {
		return err
	}
	if strategy != "ours" && strategy != "theirs" {
		return errors.New("resolution strategy must be ours or theirs")
	}
	if _, err := run(ctx, root, "checkout", "--"+strategy, "--", paths[0]); err != nil {
		return err
	}
	_, err = run(ctx, root, "add", "--", paths[0])
	return err
}

func repositoryCommand(ctx context.Context, root string, args ...string) error {
	if err := requireRepository(ctx, root); err != nil {
		return err
	}
	_, err := run(ctx, root, args...)
	return err
}

func requireGit() error {
	if _, err := exec.LookPath("git"); err != nil {
		return &CommandError{Message: "Git is not installed"}
	}
	return nil
}

func requireRepository(ctx context.Context, root string) error {
	status, err := Status(ctx, root)
	if err != nil {
		return err
	}
	if !status.Available {
		return &CommandError{Message: "Git is not installed"}
	}
	if !status.Initialized {
		return ErrNotRepository
	}
	return nil
}

func run(ctx context.Context, root string, args ...string) ([]byte, error) {
	command := exec.CommandContext(ctx, "git", args...)
	command.Dir = root
	command.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	var stderr bytes.Buffer
	command.Stderr = &stderr
	out, err := command.Output()
	if err != nil {
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			message = err.Error()
		}
		return nil, &CommandError{Message: message}
	}
	return out, nil
}

func parseStatus(out []byte, status *domain.GitStatus) {
	records := bytes.Split(out, []byte{0})
	for index := 0; index < len(records); index++ {
		record := string(records[index])
		switch {
		case strings.HasPrefix(record, "# branch.head "):
			status.Branch = strings.TrimPrefix(record, "# branch.head ")
		case strings.HasPrefix(record, "# branch.upstream "):
			status.Upstream = strings.TrimPrefix(record, "# branch.upstream ")
		case strings.HasPrefix(record, "# branch.ab "):
			fields := strings.Fields(record)
			if len(fields) == 4 {
				status.Ahead, _ = strconv.Atoi(strings.TrimPrefix(fields[2], "+"))
				status.Behind, _ = strconv.Atoi(strings.TrimPrefix(fields[3], "-"))
			}
		case strings.HasPrefix(record, "1 "):
			appendChange(status, strings.SplitN(record, " ", 9), 8, "")
		case strings.HasPrefix(record, "2 "):
			original := ""
			if index+1 < len(records) {
				index++
				original = string(records[index])
			}
			appendChange(status, strings.SplitN(record, " ", 10), 9, original)
		case strings.HasPrefix(record, "u "):
			appendChange(status, strings.SplitN(record, " ", 11), 10, "")
		case strings.HasPrefix(record, "? "):
			status.Changes = append(status.Changes, domain.GitChange{Path: strings.TrimPrefix(record, "? "), IndexStatus: "?", WorktreeStatus: "?"})
		}
	}
}

func appendChange(status *domain.GitStatus, fields []string, pathIndex int, original string) {
	if len(fields) <= pathIndex || len(fields[1]) != 2 {
		return
	}
	status.Changes = append(status.Changes, domain.GitChange{
		Path: fields[pathIndex], OriginalPath: original,
		IndexStatus: fields[1][:1], WorktreeStatus: fields[1][1:],
	})
}

func pathArgs(prefix, paths []string) ([]string, error) {
	result := append([]string(nil), prefix...)
	for _, value := range paths {
		value = filepath.ToSlash(value)
		if value == "." {
			result = append(result, value)
			continue
		}
		if value == "" || value != filepath.ToSlash(filepath.Clean(value)) || filepath.IsAbs(value) || value == ".." || strings.HasPrefix(value, "../") || value == ".symtab" || strings.HasPrefix(value, ".symtab/") || strings.ContainsRune(value, 0) {
			return nil, ErrInvalidPath
		}
		result = append(result, ":(top,literal)"+value)
	}
	return result, nil
}

func samePath(a, b string) bool {
	resolvedA, errA := filepath.EvalSymlinks(a)
	resolvedB, errB := filepath.EvalSymlinks(b)
	if errA != nil || errB != nil {
		return filepath.Clean(a) == filepath.Clean(b)
	}
	return filepath.Clean(resolvedA) == filepath.Clean(resolvedB)
}

func ensureIgnored(root, line string) error {
	path := filepath.Join(root, ".gitignore")
	content, err := os.ReadFile(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	for _, candidate := range strings.Split(string(content), "\n") {
		if strings.TrimSpace(candidate) == line {
			return nil
		}
	}
	if len(content) > 0 && content[len(content)-1] != '\n' {
		content = append(content, '\n')
	}
	content = append(content, line...)
	content = append(content, '\n')
	return os.WriteFile(path, content, 0o644)
}
