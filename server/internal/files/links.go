package files

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/symtab-pkm/server/internal/domain"
)

var (
	wikiLinkPattern     = regexp.MustCompile(`!?\[\[([^\]\n]+)\]\]`)
	markdownLinkPattern = regexp.MustCompile(`!?\[[^\]\n]*\]\(([^)\n]+)\)`)
)

type linkRewrite struct {
	oldPath string
	newPath string
	before  []byte
	after   string
}

type replacement struct {
	start int
	end   int
	text  string
}

type resolutionMode int

const (
	resolutionVault resolutionMode = iota
	resolutionRelative
	resolutionFilename
)

func (s *Service) planLinkRewrites(sourcePath, destinationPath string) ([]linkRewrite, error) {
	filesByPath := make(map[string]struct{})
	var markdownPaths []string
	err := filepath.WalkDir(s.root, func(current string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if current == s.root {
			return nil
		}
		relative, err := filepath.Rel(s.root, current)
		if err != nil {
			return err
		}
		relative = filepath.ToSlash(relative)
		if IsIgnored(relative) {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if !entry.Type().IsRegular() {
			return nil
		}
		filesByPath[relative] = struct{}{}
		extension := strings.ToLower(path.Ext(relative))
		if extension == ".md" || extension == ".markdown" {
			markdownPaths = append(markdownPaths, relative)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.planLinkRewritesFromPaths(sourcePath, destinationPath, filesByPath, markdownPaths)
}

func (s *Service) planLinkRewritesFromCatalog(
	sourcePath, destinationPath string,
	entries []domain.FileEntry,
	linkSources []string,
) ([]linkRewrite, error) {
	filesByPath := make(map[string]struct{}, len(entries))
	for _, entry := range entries {
		if entry.Kind != domain.FileKindDirectory {
			filesByPath[entry.Path] = struct{}{}
		}
	}
	return s.planLinkRewritesFromPaths(sourcePath, destinationPath, filesByPath, linkSources)
}

func (s *Service) planLinkRewritesFromPaths(
	sourcePath, destinationPath string,
	filesByPath map[string]struct{},
	markdownPaths []string,
) ([]linkRewrite, error) {
	rewrites := make([]linkRewrite, 0)
	for _, notePath := range markdownPaths {
		content, err := os.ReadFile(filepath.Join(s.root, filepath.FromSlash(notePath)))
		if errors.Is(err, os.ErrNotExist) {
			// Watcher may not have replaced an indexed source path from a preceding move yet.
			continue
		}
		if err != nil {
			return nil, err
		}
		updated, changed := rewriteDocumentLinks(string(content), notePath, sourcePath, destinationPath, filesByPath)
		if changed {
			rewrites = append(rewrites, linkRewrite{
				oldPath: notePath,
				newPath: movedPath(notePath, sourcePath, destinationPath),
				before:  content,
				after:   updated,
			})
		}
	}
	return rewrites, nil
}

func (s *Service) applyLinkRewrites(rewrites []linkRewrite) error {
	var rewriteErrors []error
	for _, rewrite := range rewrites {
		resolved := filepath.Join(s.root, filepath.FromSlash(rewrite.newPath))
		current, err := os.ReadFile(resolved)
		if err != nil {
			rewriteErrors = append(rewriteErrors, err)
			continue
		}
		if hash(current) != hash(rewrite.before) {
			rewriteErrors = append(rewriteErrors, fmt.Errorf("%s changed during move", rewrite.newPath))
			continue
		}
		info, err := os.Stat(resolved)
		if err == nil {
			_, err = writeAtomic(resolved, rewrite.after, info.Mode().Perm())
		}
		if err != nil {
			rewriteErrors = append(rewriteErrors, err)
		}
	}
	return errors.Join(rewriteErrors...)
}

func rewriteDocumentLinks(content, notePath, sourcePath, destinationPath string, filesByPath map[string]struct{}) (string, bool) {
	masked := maskCode(content)
	replacements := make([]replacement, 0)

	for _, match := range wikiLinkPattern.FindAllStringSubmatchIndex(masked, -1) {
		inside := content[match[2]:match[3]]
		target, suffix := splitLinkTarget(inside)
		resolved, mode, ok := resolveLink(notePath, target, filesByPath)
		if !ok {
			continue
		}
		newTarget, change := rewrittenTarget(notePath, target, resolved, mode, sourcePath, destinationPath, true)
		if change {
			replacements = append(replacements, replacement{match[2], match[3], newTarget + suffix})
		}
	}
	for _, match := range markdownLinkPattern.FindAllStringSubmatchIndex(masked, -1) {
		rawDestination := strings.TrimSpace(content[match[2]:match[3]])
		wrapped := strings.HasPrefix(rawDestination, "<") && strings.HasSuffix(rawDestination, ">")
		if wrapped {
			rawDestination = strings.TrimSuffix(strings.TrimPrefix(rawDestination, "<"), ">")
		}
		target, suffix := splitMarkdownTarget(rawDestination)
		resolved, mode, ok := resolveLink(notePath, target, filesByPath)
		if !ok {
			continue
		}
		newTarget, change := rewrittenTarget(notePath, target, resolved, mode, sourcePath, destinationPath, false)
		if change {
			if wrapped {
				newTarget = "<" + newTarget + suffix + ">"
			} else {
				newTarget += suffix
			}
			replacements = append(replacements, replacement{match[2], match[3], newTarget})
		}
	}
	if len(replacements) == 0 {
		return content, false
	}
	sort.Slice(replacements, func(i, j int) bool { return replacements[i].start > replacements[j].start })
	updated := content
	for _, item := range replacements {
		updated = updated[:item.start] + item.text + updated[item.end:]
	}
	return updated, updated != content
}

func resolveLink(notePath, target string, filesByPath map[string]struct{}) (string, resolutionMode, bool) {
	target = path.Clean(strings.TrimSpace(strings.ReplaceAll(target, "\\", "/")))
	if target == "." || target == ".." || strings.HasPrefix(target, "../") && path.Dir(notePath) == "." ||
		strings.HasPrefix(target, "/") || strings.Contains(target, "://") || strings.ContainsRune(target, '\x00') {
		return "", 0, false
	}
	if candidate, ok := existingCandidate(target, filesByPath); ok {
		return candidate, resolutionVault, true
	}
	relative := path.Clean(path.Join(path.Dir(notePath), target))
	if candidate, ok := existingCandidate(relative, filesByPath); ok {
		return candidate, resolutionRelative, true
	}

	needle := path.Base(target)
	matches := make([]string, 0, 1)
	for candidate := range filesByPath {
		candidateBase := path.Base(candidate)
		if candidateBase == needle || path.Ext(needle) == "" && strings.TrimSuffix(candidateBase, path.Ext(candidateBase)) == needle {
			matches = append(matches, candidate)
		}
	}
	if len(matches) == 1 {
		return matches[0], resolutionFilename, true
	}
	return "", 0, false
}

func existingCandidate(candidate string, filesByPath map[string]struct{}) (string, bool) {
	if _, ok := filesByPath[candidate]; ok {
		return candidate, true
	}
	if path.Ext(candidate) == "" {
		if _, ok := filesByPath[candidate+".md"]; ok {
			return candidate + ".md", true
		}
		if _, ok := filesByPath[candidate+".markdown"]; ok {
			return candidate + ".markdown", true
		}
	}
	return "", false
}

func rewrittenTarget(notePath, originalTarget, resolved string, mode resolutionMode, sourcePath, destinationPath string, wiki bool) (string, bool) {
	newNotePath := movedPath(notePath, sourcePath, destinationPath)
	newResolved := movedPath(resolved, sourcePath, destinationPath)
	noteMoved := newNotePath != notePath
	targetMoved := newResolved != resolved
	if !targetMoved && (!noteMoved || mode != resolutionRelative) {
		return originalTarget, false
	}

	var updated string
	switch mode {
	case resolutionRelative:
		relative, err := filepath.Rel(filepath.FromSlash(path.Dir(newNotePath)), filepath.FromSlash(newResolved))
		if err != nil {
			return originalTarget, false
		}
		updated = filepath.ToSlash(relative)
	case resolutionFilename:
		updated = path.Base(newResolved)
	default:
		updated = newResolved
	}
	if wiki && path.Ext(originalTarget) == "" {
		updated = strings.TrimSuffix(updated, path.Ext(updated))
	}
	return updated, updated != originalTarget
}

func movedPath(candidate, sourcePath, destinationPath string) string {
	if candidate == sourcePath {
		return destinationPath
	}
	if strings.HasPrefix(candidate, sourcePath+"/") {
		return destinationPath + strings.TrimPrefix(candidate, sourcePath)
	}
	return candidate
}

func splitLinkTarget(value string) (string, string) {
	if index := strings.IndexAny(value, "#|"); index >= 0 {
		return value[:index], value[index:]
	}
	return value, ""
}

func splitMarkdownTarget(value string) (string, string) {
	if index := strings.IndexByte(value, '#'); index >= 0 {
		return value[:index], value[index:]
	}
	return value, ""
}

func maskCode(content string) string {
	masked := []byte(content)
	inFence := false
	for offset := 0; offset < len(masked); {
		lineEnd := offset + strings.IndexByte(content[offset:], '\n')
		if lineEnd < offset {
			lineEnd = len(masked)
		}
		trimmed := strings.TrimSpace(content[offset:lineEnd])
		if strings.HasPrefix(trimmed, "```") || strings.HasPrefix(trimmed, "~~~") {
			blank(masked[offset:lineEnd])
			inFence = !inFence
		} else if inFence {
			blank(masked[offset:lineEnd])
		} else {
			inInline := false
			for index := offset; index < lineEnd; index++ {
				if content[index] == '`' {
					inInline = !inInline
					masked[index] = ' '
				} else if inInline {
					masked[index] = ' '
				}
			}
		}
		offset = lineEnd + 1
	}
	return string(masked)
}

func blank(content []byte) {
	for index := range content {
		content[index] = ' '
	}
}
