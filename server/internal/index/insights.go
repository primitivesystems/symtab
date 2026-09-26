package index

import (
	"fmt"
	"path"
	"regexp"
	"sort"
	"strings"
	"unicode"

	"github.com/symtab-pkm/server/internal/domain"
)

const maxReferenceCandidates = 250

func (s *Store) Facets() (domain.VaultFacets, error) {
	result := domain.VaultFacets{
		Tags:       []domain.FacetCount{},
		Properties: []domain.FacetCount{},
	}
	if err := s.db.Raw(
		"SELECT tag AS name, COUNT(DISTINCT source_path) AS count FROM tags GROUP BY tag ORDER BY count DESC, tag",
	).Scan(&result.Tags).Error; err != nil {
		return domain.VaultFacets{}, err
	}
	if err := s.db.Raw(
		"SELECT key AS name, COUNT(DISTINCT source_path) AS count FROM properties GROUP BY key ORDER BY count DESC, key",
	).Scan(&result.Properties).Error; err != nil {
		return domain.VaultFacets{}, err
	}
	return result, nil
}

func (s *Store) References(targetPath string, includeUnlinked bool) (domain.DocumentReferences, error) {
	result := domain.DocumentReferences{
		Linked:   []domain.DocumentReference{},
		Unlinked: []domain.DocumentReference{},
		Outgoing: []string{},
	}
	graph, err := s.Graph()
	if err != nil {
		return result, err
	}
	linkedSources := make(map[string]struct{})
	nodeLabels := make(map[string]string, len(graph.Nodes))
	for _, node := range graph.Nodes {
		nodeLabels[node.ID] = node.Label
	}
	for _, edge := range graph.Edges {
		if edge.Target == targetPath {
			linkedSources[edge.Source] = struct{}{}
		}
		if edge.Source == targetPath {
			target := edge.Target
			if strings.HasPrefix(target, "missing:") {
				target = nodeLabels[target]
			}
			if target != "" {
				result.Outgoing = append(result.Outgoing, target)
			}
		}
	}
	sort.Strings(result.Outgoing)
	if !s.ftsEnabled {
		return result, nil
	}
	if !includeUnlinked {
		sources := make([]string, 0, len(linkedSources))
		for source := range linkedSources {
			sources = append(sources, source)
		}
		if len(sources) == 0 {
			return result, nil
		}
		var rows []struct {
			RelativePath string
			Content      string
		}
		if err := s.db.Raw(
			"SELECT relative_path, content FROM files_fts WHERE relative_path IN ?", sources,
		).Scan(&rows).Error; err != nil {
			return result, err
		}
		for _, row := range rows {
			for _, link := range extractLinks(row.Content) {
				if linkMatchesTarget(link.target, row.RelativePath, targetPath) {
					line, excerpt := referenceLocation(row.Content, link.position)
					result.Linked = append(result.Linked, domain.DocumentReference{
						Source: row.RelativePath, Line: line, Excerpt: excerpt,
					})
				}
			}
		}
		sortReferences(result.Linked)
		return result, nil
	}

	title := strings.TrimSuffix(strings.TrimSuffix(path.Base(targetPath), ".markdown"), ".md")
	terms := searchTerms(title)
	if len(terms) == 0 {
		return result, nil
	}
	matchQuery := strings.Join(terms, " AND ")
	var candidates []struct {
		RelativePath string
		Content      string
	}
	if err := s.db.Raw(
		"SELECT relative_path, content FROM files_fts WHERE files_fts MATCH ? AND relative_path != ? LIMIT ?",
		matchQuery, targetPath, maxReferenceCandidates,
	).Scan(&candidates).Error; err != nil {
		return result, err
	}

	seenCandidates := make(map[string]struct{}, len(candidates))
	for _, candidate := range candidates {
		seenCandidates[candidate.RelativePath] = struct{}{}
	}
	missingLinked := make([]string, 0)
	for source := range linkedSources {
		if _, exists := seenCandidates[source]; !exists {
			missingLinked = append(missingLinked, source)
		}
	}
	if len(missingLinked) > 0 {
		var linkedRows []struct {
			RelativePath string
			Content      string
		}
		if err := s.db.Raw(
			"SELECT relative_path, content FROM files_fts WHERE relative_path IN ?",
			missingLinked,
		).Scan(&linkedRows).Error; err != nil {
			return result, err
		}
		candidates = append(candidates, linkedRows...)
	}

	mentionPattern, err := regexp.Compile(
		`(?i)(^|[^\p{L}\p{N}_])(` + regexp.QuoteMeta(title) + `)($|[^\p{L}\p{N}_])`,
	)
	if err != nil {
		return result, fmt.Errorf("compile mention query: %w", err)
	}
	for _, candidate := range candidates {
		masked := maskMarkdownCode(candidate.Content)
		links := extractLinks(candidate.Content)
		for _, link := range links {
			if link.position >= 0 && link.position < len(masked) {
				end := min(link.position+linkLengthAt(masked, link.position), len(masked))
				masked = masked[:link.position] + strings.Repeat(" ", end-link.position) + masked[end:]
			}
			if _, linked := linkedSources[candidate.RelativePath]; linked &&
				linkMatchesTarget(link.target, candidate.RelativePath, targetPath) {
				line, excerpt := referenceLocation(candidate.Content, link.position)
				result.Linked = append(result.Linked, domain.DocumentReference{
					Source: candidate.RelativePath, Line: line, Excerpt: excerpt,
				})
			}
		}
		for _, match := range mentionPattern.FindAllStringSubmatchIndex(masked, -1) {
			if len(match) < 6 {
				continue
			}
			line, excerpt := referenceLocation(candidate.Content, match[4])
			result.Unlinked = append(result.Unlinked, domain.DocumentReference{
				Source: candidate.RelativePath, Line: line, Excerpt: excerpt,
			})
		}
	}
	sortReferences(result.Linked)
	sortReferences(result.Unlinked)
	return result, nil
}

func searchTerms(value string) []string {
	raw := strings.FieldsFunc(value, func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsNumber(r)
	})
	terms := make([]string, 0, len(raw))
	for _, term := range raw {
		if term != "" {
			terms = append(terms, `"`+strings.ReplaceAll(term, `"`, `""`)+`"`)
		}
	}
	return terms
}

func linkLengthAt(content string, start int) int {
	if start < 0 || start >= len(content) {
		return 0
	}
	if strings.HasPrefix(content[start:], "[[") || strings.HasPrefix(content[start:], "![[") {
		if end := strings.Index(content[start:], "]]"); end >= 0 {
			return end + 2
		}
	}
	if end := strings.IndexByte(content[start:], ')'); end >= 0 {
		return end + 1
	}
	return 1
}

func linkMatchesTarget(rawTarget, sourcePath, targetPath string) bool {
	normalized := normalizeLinkTarget(rawTarget)
	for _, candidate := range extensionCandidates(normalized) {
		if candidate == targetPath || path.Join(path.Dir(sourcePath), candidate) == targetPath {
			return true
		}
	}
	targetStem := strings.TrimSuffix(strings.TrimSuffix(path.Base(targetPath), ".markdown"), ".md")
	rawStem := strings.TrimSuffix(strings.TrimSuffix(path.Base(normalized), ".markdown"), ".md")
	return strings.EqualFold(targetStem, rawStem)
}

func referenceLocation(content string, index int) (int, string) {
	if index < 0 {
		index = 0
	}
	if index > len(content) {
		index = len(content)
	}
	line := strings.Count(content[:index], "\n") + 1
	start := strings.LastIndex(content[:index], "\n") + 1
	endOffset := strings.IndexByte(content[index:], '\n')
	end := len(content)
	if endOffset >= 0 {
		end = index + endOffset
	}
	return line, strings.TrimSpace(content[start:end])
}

func sortReferences(references []domain.DocumentReference) {
	sort.Slice(references, func(i, j int) bool {
		if references[i].Source == references[j].Source {
			return references[i].Line < references[j].Line
		}
		return references[i].Source < references[j].Source
	})
}
