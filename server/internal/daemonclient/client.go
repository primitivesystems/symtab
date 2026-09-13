package daemonclient

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/flux-pkm/server/internal/domain"
)

type Client struct {
	origin string
	token  string
	http   *http.Client
}

func New(origin, token string) (*Client, error) {
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Scheme != "http" || parsed.Host == "" || token == "" {
		return nil, errors.New("invalid Symtab daemon connection")
	}
	return &Client{origin: strings.TrimRight(origin, "/"), token: token, http: &http.Client{Timeout: 30 * time.Second}}, nil
}

func (c *Client) Status(ctx context.Context) (domain.ServerStatus, error) {
	return request[domain.ServerStatus](ctx, c, http.MethodGet, "/api/v1/status", nil)
}

func (c *Client) OpenVault(ctx context.Context, path string) (domain.VaultInfo, error) {
	return request[domain.VaultInfo](ctx, c, http.MethodPost, "/api/v1/vaults/open", map[string]string{"path": path})
}

func (c *Client) ListFiles(vaultID string) ([]domain.FileEntry, error) {
	return request[[]domain.FileEntry](context.Background(), c, http.MethodGet, "/api/v1/vaults/"+url.PathEscape(vaultID)+"/files", nil)
}

func (c *Client) ReadFile(vaultID, path string) (domain.FileDocument, error) {
	endpoint := "/api/v1/vaults/" + url.PathEscape(vaultID) + "/files/content?path=" + url.QueryEscape(path)
	return request[domain.FileDocument](context.Background(), c, http.MethodGet, endpoint, nil)
}

func (c *Client) Graph(vaultID string) (domain.VaultGraph, error) {
	return request[domain.VaultGraph](context.Background(), c, http.MethodGet, "/api/v1/vaults/"+url.PathEscape(vaultID)+"/graph", nil)
}

func (c *Client) VaultRevision(vaultID string) (uint64, error) {
	change, err := request[domain.VaultChange](context.Background(), c, http.MethodGet, "/api/v1/vaults/"+url.PathEscape(vaultID)+"/revision", nil)
	return change.Revision, err
}

func (c *Client) CreateFile(vaultID, path, content string) (domain.FileDocument, error) {
	body := map[string]string{"path": path, "content": content}
	return request[domain.FileDocument](context.Background(), c, http.MethodPost, "/api/v1/vaults/"+url.PathEscape(vaultID)+"/files", body)
}

func (c *Client) SaveFile(vaultID, path, content, expectedHash string) (domain.SaveResult, error) {
	body := map[string]string{"path": path, "content": content, "expectedHash": expectedHash}
	return request[domain.SaveResult](context.Background(), c, http.MethodPut, "/api/v1/vaults/"+url.PathEscape(vaultID)+"/files/content", body)
}

func (c *Client) ApplyVaultPlan(vaultID string, operations []domain.VaultPlanOperation) (domain.VaultPlanResult, error) {
	body := map[string]any{"operations": operations}
	return request[domain.VaultPlanResult](context.Background(), c, http.MethodPost, "/api/v1/vaults/"+url.PathEscape(vaultID)+"/files/plan", body)
}

func (c *Client) MoveFileExpected(vaultID, sourcePath, destinationPath, expectedHash string) (domain.FileEntry, error) {
	body := map[string]string{"sourcePath": sourcePath, "destinationPath": destinationPath, "expectedHash": expectedHash}
	return request[domain.FileEntry](context.Background(), c, http.MethodPost, "/api/v1/vaults/"+url.PathEscape(vaultID)+"/files/move", body)
}

func (c *Client) DeleteFileExpected(vaultID, path, expectedHash string) (domain.TrashEntry, error) {
	endpoint := "/api/v1/vaults/" + url.PathEscape(vaultID) + "/files?path=" + url.QueryEscape(path) + "&expectedHash=" + url.QueryEscape(expectedHash)
	return request[domain.TrashEntry](context.Background(), c, http.MethodDelete, endpoint, nil)
}

func request[T any](ctx context.Context, client *Client, method, endpoint string, body any) (T, error) {
	var zero T
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return zero, err
		}
		reader = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, client.origin+endpoint, reader)
	if err != nil {
		return zero, err
	}
	request.Header.Set("X-Flux-Desktop-Token", client.token)
	request.Header.Set("X-Flux-Client", "mcp")
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := client.http.Do(request)
	if err != nil {
		return zero, err
	}
	defer response.Body.Close()
	content, err := io.ReadAll(io.LimitReader(response.Body, 64<<20))
	if err != nil {
		return zero, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var problem struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(content, &problem) == nil && problem.Error != "" {
			return zero, errors.New(problem.Error)
		}
		return zero, fmt.Errorf("Symtab daemon returned HTTP %d", response.StatusCode)
	}
	if len(content) == 0 {
		return zero, nil
	}
	if err := json.Unmarshal(content, &zero); err != nil {
		return zero, err
	}
	return zero, nil
}
