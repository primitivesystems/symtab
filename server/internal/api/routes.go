package api

import (
	"context"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/flux-pkm/server/internal/agent"
	application "github.com/flux-pkm/server/internal/app"
	"github.com/flux-pkm/server/internal/appdata"
	"github.com/flux-pkm/server/internal/domain"
	"github.com/flux-pkm/server/internal/files"
	gitadapter "github.com/flux-pkm/server/internal/git"
	"github.com/flux-pkm/server/internal/modelproviders"
	"github.com/flux-pkm/server/internal/plugins"
	"github.com/flux-pkm/server/internal/vault"
	"github.com/gin-gonic/gin"
)

type Handler struct {
	authentication gin.HandlerFunc
	app            *application.Service
	appData        *appdata.Store
	desktopToken   string
	mcpEnabled     bool
	plugins        *plugins.Manager
	modelProviders *modelproviders.Service
	agent          *agent.Service
}

const maxRequestBodyBytes = 50 << 20

type RouteOption func(*Handler)

func WithAuthentication(middleware gin.HandlerFunc) RouteOption {
	return func(handler *Handler) { handler.authentication = middleware }
}

func WithAppData(store *appdata.Store) RouteOption {
	return func(handler *Handler) { handler.appData = store }
}

func WithDesktopToken(token string) RouteOption {
	return func(handler *Handler) { handler.desktopToken = token }
}

func WithMCPConnections() RouteOption {
	return func(handler *Handler) { handler.mcpEnabled = true }
}

func WithPlugins(manager *plugins.Manager) RouteOption {
	return func(handler *Handler) { handler.plugins = manager }
}

func WithModelProviders(service *modelproviders.Service) RouteOption {
	return func(handler *Handler) { handler.modelProviders = service }
}

func WithAgent(service *agent.Service) RouteOption {
	return func(handler *Handler) { handler.agent = service }
}

func RegisterRoutes(router *gin.Engine, app *application.Service, options ...RouteOption) {
	handler := &Handler{app: app}
	for _, option := range options {
		option(handler)
	}
	v1 := router.Group("/api/v1")
	if handler.authentication != nil {
		v1.Use(handler.authentication)
	}
	v1.Use(handler.requireDesktopToken, limitRequestBody)
	v1.GET("/status", handler.status)
	v1.GET("/bootstrap", handler.bootstrap)
	v1.GET("/recent-vaults", handler.recentVaults)
	v1.PUT("/recent-vaults/:vaultId", handler.rememberVault)
	v1.DELETE("/recent-vaults/:vaultId", handler.forgetVault)
	v1.GET("/workspace-sessions/:windowId", handler.workspace)
	v1.PUT("/workspace-sessions/:windowId", handler.saveWorkspace)
	v1.GET("/app-settings", handler.appSettings)
	v1.PUT("/app-settings/:key", handler.putAppSetting)
	if handler.mcpEnabled {
		v1.GET("/mcp-connections", handler.mcpConnections)
		v1.POST("/mcp-connections", handler.createMCPConnection)
		v1.DELETE("/mcp-connections/:connectionId", handler.revokeMCPConnection)
	}
	if handler.plugins != nil {
		v1.GET("/plugins", handler.listPlugins)
		v1.GET("/marketplace", handler.marketplace)
		v1.POST("/plugins/install", handler.installPlugin)
		v1.POST("/plugins/marketplace/:pluginId/install", handler.installMarketplacePlugin)
		v1.POST("/plugins/:pluginId/:version/activate", handler.activatePlugin)
		v1.POST("/vaults/:vaultId/plugins/:pluginId/:version/approve", handler.approvePluginUpdate)
		v1.POST("/plugins/:pluginId/rollback", handler.rollbackPlugin)
		v1.DELETE("/plugins/:pluginId/:version", handler.uninstallPlugin)
	}
	v1.POST("/vaults/open", handler.openVault)
	v1.GET("/vaults/available", handler.availableVaults)
	v1.POST("/vaults/create", handler.createVault)
	v1.GET("/vaults/:vaultId", handler.vaultInfo)
	v1.GET("/vaults/:vaultId/config", handler.vaultConfig)
	v1.PUT("/vaults/:vaultId/config", handler.saveVaultConfig)
	v1.GET("/vaults/:vaultId/revision", handler.vaultRevision)
	v1.GET("/vaults/:vaultId/events", handler.vaultEvents)
	v1.POST("/vaults/:vaultId/index/rebuild", handler.rebuildIndex)
	if handler.plugins != nil {
		v1.GET("/vaults/:vaultId/plugins", handler.listVaultPlugins)
		v1.GET("/vaults/:vaultId/plugin-bundles", handler.pluginBundles)
		v1.POST("/vaults/:vaultId/plugins/:pluginId/capabilities/:capability", handler.invokePluginCapability)
		v1.GET("/vaults/:vaultId/plugins/:pluginId/views/:viewId", handler.pluginView)
		v1.GET("/vaults/:vaultId/plugins/:pluginId/settings", handler.pluginSettings)
		v1.PUT("/vaults/:vaultId/plugins/:pluginId/settings", handler.putPluginSettings)
		v1.PUT("/vaults/:vaultId/plugins/:pluginId", handler.enableVaultPlugin)
		v1.DELETE("/vaults/:vaultId/plugins/:pluginId", handler.disableVaultPlugin)
	}
	v1.GET("/vaults/:vaultId/files", handler.listFiles)
	v1.GET("/vaults/:vaultId/files/children", handler.listFileChildren)
	v1.GET("/vaults/:vaultId/graph", handler.graph)
	v1.GET("/vaults/:vaultId/search", handler.search)
	v1.GET("/vaults/:vaultId/references", handler.references)
	v1.GET("/vaults/:vaultId/facets", handler.facets)
	v1.GET("/vaults/:vaultId/files/metadata", handler.fileMetadata)
	v1.POST("/vaults/:vaultId/directories", handler.createDirectory)
	v1.POST("/vaults/:vaultId/files", handler.createFile)
	v1.POST("/vaults/:vaultId/files/plan", handler.applyVaultPlan)
	v1.DELETE("/vaults/:vaultId/files", handler.deleteFile)
	v1.GET("/vaults/:vaultId/files/content", handler.readFile)
	v1.GET("/vaults/:vaultId/files/raw", handler.readRawFile)
	v1.PUT("/vaults/:vaultId/files/content", handler.saveFile)
	v1.PATCH("/vaults/:vaultId/files/content", handler.patchFile)
	v1.POST("/vaults/:vaultId/files/move", handler.moveFile)
	v1.POST("/vaults/:vaultId/files/restore", handler.restoreFile)
	v1.GET("/vaults/:vaultId/trash", handler.listTrash)
	v1.DELETE("/vaults/:vaultId/trash", handler.purgeTrash)
	v1.DELETE("/vaults/:vaultId/trash/:trashId", handler.permanentlyDelete)
	if handler.modelProviders != nil {
		v1.GET("/model-providers", handler.listModelProviders)
		v1.GET("/model-providers/:providerId", handler.getModelProvider)
		v1.PUT("/model-providers/:providerId", handler.updateModelProvider)
		v1.GET("/ai-runtimes", handler.listAIRuntimes)
		v1.GET("/ai-runtimes/:runtimeId", handler.getAIRuntime)
	}
	if handler.agent != nil {
		handler.registerAgentRoutes(v1)
	}
}

func (h *Handler) vaultConfig(c *gin.Context) {
	content, err := h.app.VaultConfig(c.Param("vaultId"))
	if err != nil {
		writeError(c, err)
		return
	}
	c.Data(http.StatusOK, "application/json", content)
}

func (h *Handler) saveVaultConfig(c *gin.Context) {
	content, err := c.GetRawData()
	if err != nil {
		writeRequestError(c, err)
		return
	}
	if err := h.app.SaveVaultConfig(c.Param("vaultId"), content); err != nil {
		writeRequestError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

type createMCPConnectionRequest struct {
	Name     string   `json:"name" binding:"required"`
	Mode     string   `json:"mode" binding:"required"`
	VaultIDs []string `json:"vaultIds" binding:"required,min=1"`
}

func (h *Handler) mcpConnections(c *gin.Context) {
	if !h.requireAppData(c) {
		return
	}
	items, err := h.appData.MCPConnections()
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, items)
}

func (h *Handler) createMCPConnection(c *gin.Context) {
	if !h.requireAppData(c) {
		return
	}
	var request createMCPConnectionRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		writeRequestError(c, err)
		return
	}
	if request.Mode != "read_only" && request.Mode != "guided_write" &&
		request.Mode != "trusted_workspace" {
		c.JSON(http.StatusBadRequest, gin.H{"code": "invalid_mode", "error": "invalid approval mode"})
		return
	}
	capabilities := `["vault.read"]`
	if request.Mode != "read_only" {
		capabilities = `["vault.read","vault.write","vault.move","vault.delete"]`
	}
	item, err := h.appData.CreateMCPConnection(
		request.Name, request.Mode, request.VaultIDs, capabilities,
	)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusCreated, item)
}

func (h *Handler) revokeMCPConnection(c *gin.Context) {
	if !h.requireAppData(c) {
		return
	}
	if err := h.appData.RevokeMCPConnection(c.Param("connectionId")); err != nil {
		writeError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) requirePlugins(c *gin.Context) bool {
	if h.plugins != nil {
		return true
	}
	c.JSON(http.StatusServiceUnavailable, gin.H{"code": "plugins_unavailable", "error": "plugin service is unavailable"})
	return false
}

func (h *Handler) listPlugins(c *gin.Context) {
	if !h.requirePlugins(c) {
		return
	}
	items, err := h.plugins.List()
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, items)
}

func (h *Handler) marketplace(c *gin.Context) {
	if !h.requirePlugins(c) {
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 20*time.Second)
	defer cancel()
	index, err := h.plugins.Marketplace(ctx)
	if err != nil {
		writePluginError(c, err)
		return
	}
	c.JSON(http.StatusOK, index)
}

func (h *Handler) installMarketplacePlugin(c *gin.Context) {
	if !h.requirePlugins(c) {
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 45*time.Second)
	defer cancel()
	result, err := h.plugins.InstallMarketplace(ctx, c.Param("pluginId"))
	if err != nil {
		writePluginError(c, err)
		return
	}
	c.JSON(http.StatusCreated, result)
}

type installPluginRequest struct {
	PackageBase64 string `json:"packageBase64" binding:"required"`
	SHA256        string `json:"sha256" binding:"required"`
	Development   bool   `json:"development,omitempty"`
}

func (h *Handler) installPlugin(c *gin.Context) {
	if !h.requirePlugins(c) {
		return
	}
	var request installPluginRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		writeRequestError(c, err)
		return
	}
	if request.Development && h.desktopToken == "" {
		c.JSON(http.StatusForbidden, gin.H{"code": "desktop_only", "error": "development plugins require the local desktop runtime"})
		return
	}
	data, err := base64.StdEncoding.DecodeString(request.PackageBase64)
	if err != nil || len(data) > 25<<20 {
		c.JSON(http.StatusBadRequest, gin.H{"code": "invalid_plugin_package", "error": "plugin package must be valid base64 and at most 25 MiB"})
		return
	}
	temporary, err := os.CreateTemp("", "flux-plugin-*.zip")
	if err != nil {
		writeError(c, err)
		return
	}
	name := temporary.Name()
	defer os.Remove(name)
	if _, err = temporary.Write(data); err == nil {
		err = temporary.Close()
	} else {
		_ = temporary.Close()
	}
	if err != nil {
		writeError(c, err)
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()
	var result plugins.InstallResult
	if request.Development {
		result, err = h.plugins.InstallDevelopmentPackage(ctx, name, request.SHA256)
	} else {
		result, err = h.plugins.InstallPackage(ctx, name, request.SHA256)
	}
	if err != nil {
		writePluginError(c, err)
		return
	}
	c.JSON(http.StatusCreated, result)
}

func (h *Handler) activatePlugin(c *gin.Context) {
	if !h.requirePlugins(c) {
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()
	if err := h.plugins.Activate(ctx, c.Param("pluginId"), c.Param("version")); err != nil {
		writePluginError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) approvePluginUpdate(c *gin.Context) {
	if !h.requirePlugins(c) {
		return
	}
	var request enablePluginRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		writeRequestError(c, err)
		return
	}
	if err := h.plugins.ApproveUpdateForVault(c.Param("vaultId"), c.Param("pluginId"), c.Param("version"), request.GrantedPermissions); err != nil {
		writePluginError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) rollbackPlugin(c *gin.Context) {
	if !h.requirePlugins(c) {
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()
	if err := h.plugins.Rollback(ctx, c.Param("pluginId")); err != nil {
		writePluginError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) uninstallPlugin(c *gin.Context) {
	if !h.requirePlugins(c) {
		return
	}
	if err := h.plugins.Uninstall(c.Param("pluginId"), c.Param("version")); err != nil {
		writePluginError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) listVaultPlugins(c *gin.Context) {
	if !h.requirePlugins(c) {
		return
	}
	items, err := h.plugins.ListForVault(c.Param("vaultId"))
	if err != nil {
		writePluginError(c, err)
		return
	}
	c.JSON(http.StatusOK, items)
}

func (h *Handler) pluginBundles(c *gin.Context) {
	if !h.requirePlugins(c) {
		return
	}
	root, err := h.app.VaultPath(c.Param("vaultId"))
	if err != nil {
		writeError(c, err)
		return
	}
	bundles, err := h.plugins.RuntimeBundles(c.Param("vaultId"), root)
	if err != nil {
		writePluginError(c, err)
		return
	}
	c.JSON(http.StatusOK, bundles)
}

func (h *Handler) pluginSettings(c *gin.Context) {
	if !h.requirePlugins(c) {
		return
	}
	root, err := h.app.VaultPath(c.Param("vaultId"))
	if err != nil {
		writeError(c, err)
		return
	}
	values, err := h.plugins.ReadSettings(root, c.Param("pluginId"))
	if err != nil {
		writePluginError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"values": values})
}

type pluginSettingsRequest struct {
	Values map[string]any `json:"values" binding:"required"`
}

func (h *Handler) putPluginSettings(c *gin.Context) {
	if !h.requirePlugins(c) {
		return
	}
	var request pluginSettingsRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		writeRequestError(c, err)
		return
	}
	root, err := h.app.VaultPath(c.Param("vaultId"))
	if err != nil {
		writeError(c, err)
		return
	}
	if err := h.plugins.WriteSettings(root, c.Param("pluginId"), request.Values); err != nil {
		writePluginError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

type pluginCapabilityRequest struct {
	Input json.RawMessage `json:"input" binding:"required"`
}

func (h *Handler) invokePluginCapability(c *gin.Context) {
	if !h.requirePlugins(c) {
		return
	}
	capabilityName := c.Param("capability")
	if err := h.plugins.AuthorizeVaultCapability(c.Param("vaultId"), c.Param("pluginId"), capabilityName); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"code": "plugin_capability_denied", "error": err.Error()})
		return
	}
	var request pluginCapabilityRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		writeRequestError(c, err)
		return
	}
	vaultID := c.Param("vaultId")
	switch capabilityName {
	case "vault.read":
		var input struct {
			Path string `json:"path"`
		}
		if json.Unmarshal(request.Input, &input) != nil {
			writeRequestError(c, errors.New("invalid input"))
			return
		}
		result, err := h.app.ReadFile(vaultID, input.Path)
		writePluginResult(c, result, err)
	case "vault.write":
		var input struct {
			Path, Content, ExpectedHash string
		}
		if json.Unmarshal(request.Input, &input) != nil {
			writeRequestError(c, errors.New("invalid input"))
			return
		}
		result, err := h.app.SaveFile(vaultID, input.Path, input.Content, input.ExpectedHash)
		writePluginResult(c, result, err)
	case "vault.move":
		var input struct{ From, To, ExpectedHash string }
		if json.Unmarshal(request.Input, &input) != nil {
			writeRequestError(c, errors.New("invalid input"))
			return
		}
		result, err := h.app.MoveFileExpected(vaultID, input.From, input.To, input.ExpectedHash)
		writePluginResult(c, result, err)
	case "vault.delete":
		var input struct{ Path, ExpectedHash string }
		if json.Unmarshal(request.Input, &input) != nil {
			writeRequestError(c, errors.New("invalid input"))
			return
		}
		_, err := h.app.DeleteFileExpected(vaultID, input.Path, input.ExpectedHash)
		writePluginResult(c, gin.H{"path": input.Path}, err)
	case "vault.search":
		var input struct {
			Query string `json:"query"`
			Limit int    `json:"limit"`
		}
		if json.Unmarshal(request.Input, &input) != nil {
			writeRequestError(c, errors.New("invalid input"))
			return
		}
		results, err := h.app.Search(vaultID, input.Query, input.Limit)
		writePluginResult(c, gin.H{"results": results}, err)
	case "git.status":
		result, err := h.app.GitStatus(c.Request.Context(), vaultID)
		writePluginResult(c, result, err)
	case "git.init":
		err := h.app.EnableGit(c.Request.Context(), vaultID)
		writePluginResult(c, gin.H{"enabled": err == nil}, err)
	case "git.stage", "git.unstage":
		var input struct {
			Paths []string `json:"paths"`
		}
		if json.Unmarshal(request.Input, &input) != nil {
			writeRequestError(c, errors.New("invalid input"))
			return
		}
		var err error
		if capabilityName == "git.stage" {
			err = h.app.StageGit(c.Request.Context(), vaultID, input.Paths)
		} else {
			err = h.app.UnstageGit(c.Request.Context(), vaultID, input.Paths)
		}
		writePluginResult(c, gin.H{"updated": err == nil}, err)
	case "git.commit":
		var input struct {
			Message string   `json:"message"`
			Paths   []string `json:"paths"`
		}
		if json.Unmarshal(request.Input, &input) != nil || strings.TrimSpace(input.Message) == "" {
			writeRequestError(c, errors.New("invalid input"))
			return
		}
		err := h.app.CommitGit(c.Request.Context(), vaultID, input.Message, input.Paths)
		writePluginResult(c, gin.H{"committed": err == nil}, err)
	case "git.pull", "git.push", "git.fetch":
		var err error
		switch capabilityName {
		case "git.pull":
			err = h.app.PullGit(c.Request.Context(), vaultID)
		case "git.push":
			var input struct {
				Remote string `json:"remote"`
			}
			if json.Unmarshal(request.Input, &input) != nil {
				writeRequestError(c, errors.New("invalid input"))
				return
			}
			err = h.app.PushGitTo(c.Request.Context(), vaultID, input.Remote)
		default:
			err = h.app.FetchGit(c.Request.Context(), vaultID)
		}
		writePluginResult(c, gin.H{"updated": err == nil}, err)
	case "git.remote.set":
		var input struct {
			Name string `json:"name"`
			URL  string `json:"url"`
		}
		if json.Unmarshal(request.Input, &input) != nil || strings.TrimSpace(input.URL) == "" {
			writeRequestError(c, errors.New("invalid input"))
			return
		}
		if strings.TrimSpace(input.Name) == "" {
			input.Name = "origin"
		}
		err := h.app.SetGitRemote(c.Request.Context(), vaultID, input.Name, input.URL)
		writePluginResult(c, gin.H{"updated": err == nil}, err)
	case "git.remote.remove":
		var input struct {
			Name string `json:"name"`
		}
		if json.Unmarshal(request.Input, &input) != nil {
			writeRequestError(c, errors.New("invalid input"))
			return
		}
		if strings.TrimSpace(input.Name) == "" {
			input.Name = "origin"
		}
		err := h.app.RemoveGitRemote(c.Request.Context(), vaultID, input.Name)
		writePluginResult(c, gin.H{"updated": err == nil}, err)
	case "git.diff":
		var input struct {
			Path   string `json:"path"`
			Staged bool   `json:"staged"`
		}
		if json.Unmarshal(request.Input, &input) != nil || strings.TrimSpace(input.Path) == "" {
			writeRequestError(c, errors.New("invalid input"))
			return
		}
		result, err := h.app.GitDiff(c.Request.Context(), vaultID, input.Path, input.Staged)
		writePluginResult(c, result, err)
	case "git.discard":
		var input struct {
			Paths []string `json:"paths"`
		}
		if json.Unmarshal(request.Input, &input) != nil || len(input.Paths) == 0 {
			writeRequestError(c, errors.New("invalid input"))
			return
		}
		err := h.app.DiscardGit(c.Request.Context(), vaultID, input.Paths)
		writePluginResult(c, gin.H{"updated": err == nil}, err)
	case "git.branches":
		result, err := h.app.GitBranches(c.Request.Context(), vaultID)
		writePluginResult(c, gin.H{"branches": result}, err)
	case "git.checkout", "git.branch.create":
		var input struct {
			Branch string `json:"branch"`
		}
		if json.Unmarshal(request.Input, &input) != nil || strings.TrimSpace(input.Branch) == "" {
			writeRequestError(c, errors.New("invalid input"))
			return
		}
		err := h.app.CheckoutGit(c.Request.Context(), vaultID, input.Branch, capabilityName == "git.branch.create")
		writePluginResult(c, gin.H{"updated": err == nil}, err)
	case "git.history":
		var input struct {
			Limit int `json:"limit"`
		}
		if json.Unmarshal(request.Input, &input) != nil {
			writeRequestError(c, errors.New("invalid input"))
			return
		}
		result, err := h.app.GitHistory(c.Request.Context(), vaultID, input.Limit)
		writePluginResult(c, gin.H{"commits": result}, err)
	case "git.resolve":
		var input struct{ Path, Strategy string }
		if json.Unmarshal(request.Input, &input) != nil || strings.TrimSpace(input.Path) == "" {
			writeRequestError(c, errors.New("invalid input"))
			return
		}
		err := h.app.ResolveGit(c.Request.Context(), vaultID, input.Path, input.Strategy)
		writePluginResult(c, gin.H{"updated": err == nil}, err)
	case "ai.providers":
		if h.modelProviders == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"code": "ai_unavailable", "error": "AI provider service is unavailable"})
			return
		}
		writePluginResult(c, h.modelProviders.ListProviders(), nil)
	case "ai.chat":
		if h.modelProviders == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"code": "ai_unavailable", "error": "AI provider service is unavailable"})
			return
		}
		var input struct {
			Provider string                       `json:"provider"`
			Model    string                       `json:"model"`
			Messages []modelproviders.ChatMessage `json:"messages"`
			Stream   bool                         `json:"stream"`
			StreamID string                       `json:"streamId"`
		}
		if json.Unmarshal(request.Input, &input) != nil {
			writeRequestError(c, errors.New("invalid input"))
			return
		}
		if input.StreamID != "" {
			stream, err := h.modelProviders.PollChat(input.StreamID)
			if err != nil {
				writeRequestError(c, err)
				return
			}
			writePluginResult(c, stream, nil)
			return
		}
		if strings.TrimSpace(input.Provider) == "" || len(input.Messages) == 0 {
			writeRequestError(c, errors.New("invalid input"))
			return
		}
		workspace, pathErr := h.app.VaultPath(vaultID)
		if pathErr != nil {
			writeError(c, pathErr)
			return
		}
		if input.Stream {
			streamID := h.modelProviders.StartChat(workspace, input.Provider, input.Model, input.Messages)
			writePluginResult(c, gin.H{"streamId": streamID, "reply": "", "done": false}, nil)
			return
		}
		reply, err := h.modelProviders.Chat(c.Request.Context(), workspace, input.Provider, input.Model, input.Messages, nil)
		if err != nil {
			writeRequestError(c, err)
			return
		}
		writePluginResult(c, gin.H{"reply": reply}, nil)
	default:
		c.JSON(http.StatusNotImplemented, gin.H{"code": "plugin_capability_unavailable", "error": "capability is not implemented"})
	}
}

func (h *Handler) pluginView(c *gin.Context) {
	if !h.requirePlugins(c) {
		return
	}
	view, content, err := h.plugins.ReadView(c.Param("vaultId"), c.Param("pluginId"), c.Param("viewId"))
	if err != nil {
		writePluginError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"id": view.ID, "title": view.Title, "html": content})
}

func writePluginResult(c *gin.Context, result any, err error) {
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

type enablePluginRequest struct {
	GrantedPermissions []string `json:"grantedPermissions" binding:"required"`
}

func (h *Handler) enableVaultPlugin(c *gin.Context) {
	if !h.requirePlugins(c) {
		return
	}
	var request enablePluginRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		writeRequestError(c, err)
		return
	}
	root, err := h.app.VaultPath(c.Param("vaultId"))
	if err != nil {
		writeError(c, err)
		return
	}
	paths, err := h.plugins.EnableForVault(c.Param("vaultId"), root, c.Param("pluginId"), request.GrantedPermissions)
	if err != nil {
		writePluginError(c, err)
		return
	}
	c.JSON(http.StatusOK, paths)
}

func (h *Handler) disableVaultPlugin(c *gin.Context) {
	if !h.requirePlugins(c) {
		return
	}
	if err := h.plugins.DisableForVault(c.Param("vaultId"), c.Param("pluginId")); err != nil {
		writePluginError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func writePluginError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, plugins.ErrChecksumMismatch):
		c.JSON(http.StatusBadRequest, gin.H{"code": "plugin_checksum_mismatch", "error": err.Error()})
	case errors.Is(err, plugins.ErrVersionExists), errors.Is(err, plugins.ErrPluginActive), errors.Is(err, plugins.ErrPermissionApprovalNeeded):
		c.JSON(http.StatusConflict, gin.H{"code": "plugin_conflict", "error": err.Error()})
	case errors.Is(err, plugins.ErrPluginNotFound):
		c.JSON(http.StatusNotFound, gin.H{"code": "plugin_not_found", "error": err.Error()})
	case errors.Is(err, plugins.ErrRuntimeUnavailable):
		c.JSON(http.StatusServiceUnavailable, gin.H{"code": "plugin_runtime_unavailable", "error": err.Error()})
	case errors.Is(err, plugins.ErrRegistryUnavailable):
		c.JSON(http.StatusServiceUnavailable, gin.H{"code": "plugin_registry_unavailable", "error": err.Error()})
	default:
		c.JSON(http.StatusBadRequest, gin.H{"code": "invalid_plugin", "error": err.Error()})
	}
}

type pathRequest struct {
	Path string `json:"path" binding:"required"`
}

func (h *Handler) createDirectory(c *gin.Context) {
	var request pathRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		writeRequestError(c, err)
		return
	}
	entry, err := h.app.CreateDirectory(c.Param("vaultId"), request.Path)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusCreated, entry)
}

type createFileRequest struct {
	Path    string `json:"path" binding:"required"`
	Content string `json:"content"`
}

func (h *Handler) createFile(c *gin.Context) {
	var request createFileRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		writeRequestError(c, err)
		return
	}
	document, err := h.app.CreateFile(c.Param("vaultId"), request.Path, request.Content)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusCreated, document)
}

type vaultPlanRequest struct {
	Operations []domain.VaultPlanOperation `json:"operations" binding:"required"`
}

func (h *Handler) applyVaultPlan(c *gin.Context) {
	var request vaultPlanRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		writeRequestError(c, err)
		return
	}
	result, err := h.app.ApplyVaultPlan(c.Param("vaultId"), request.Operations)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) status(c *gin.Context) {
	c.JSON(http.StatusOK, h.app.Status())
}

type openVaultRequest struct {
	Path string `json:"path"`
}

func (h *Handler) openVault(c *gin.Context) {
	var request openVaultRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		writeRequestError(c, err)
		return
	}
	info, err := h.app.OpenVault(request.Path)
	if err != nil {
		writeError(c, err)
		return
	}
	if c.GetHeader("X-Flux-Client") != "mcp" {
		h.rememberOpenedVault(info)
	}
	c.JSON(http.StatusOK, info)
}

func (h *Handler) vaultInfo(c *gin.Context) {
	info, err := h.app.VaultInfo(c.Param("vaultId"))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, info)
}

func (h *Handler) availableVaults(c *gin.Context) {
	locations, err := h.app.AvailableVaults()
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, locations)
}

func (h *Handler) createVault(c *gin.Context) {
	var request pathRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		writeRequestError(c, err)
		return
	}
	info, err := h.app.CreateVault(request.Path)
	if err != nil {
		writeError(c, err)
		return
	}
	h.rememberOpenedVault(info)
	c.JSON(http.StatusCreated, info)
}

func (h *Handler) rememberOpenedVault(info domain.VaultInfo) {
	if h.appData == nil {
		return
	}
	path, err := h.app.VaultPath(info.ID)
	if err != nil {
		log.Printf("Failed to resolve vault %q path: %v", info.ID, err)
		return
	}
	if err := h.appData.RememberVault(info.ID, path, info.Name); err != nil {
		log.Printf("Failed to remember vault %q: %v", info.ID, err)
	}
}

func (h *Handler) bootstrap(c *gin.Context) {
	if !h.requireAppData(c) {
		return
	}
	bootstrap, err := h.appData.Bootstrap(c.Query("windowId"))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, bootstrap)
}

func (h *Handler) recentVaults(c *gin.Context) {
	if !h.requireAppData(c) {
		return
	}
	recent, err := h.appData.RecentVaults()
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, recent)
}

type rememberVaultRequest struct {
	Path        string `json:"path" binding:"required"`
	DisplayName string `json:"displayName" binding:"required"`
}

func (h *Handler) rememberVault(c *gin.Context) {
	if !h.requireAppData(c) {
		return
	}
	var request rememberVaultRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		writeRequestError(c, err)
		return
	}
	if err := h.appData.RememberVault(c.Param("vaultId"), request.Path, request.DisplayName); err != nil {
		writeError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) forgetVault(c *gin.Context) {
	if !h.requireAppData(c) {
		return
	}
	if err := h.appData.ForgetVault(c.Param("vaultId")); err != nil {
		writeError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) workspace(c *gin.Context) {
	if !h.requireAppData(c) {
		return
	}
	workspace, err := h.appData.Workspace(c.Param("windowId"), c.Query("vaultId"))
	if errors.Is(err, appdata.ErrNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"code": "workspace_not_found", "error": "workspace session not found"})
		return
	}
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, workspace)
}

type saveWorkspaceRequest struct {
	VaultID string          `json:"vaultId" binding:"required"`
	State   json.RawMessage `json:"state" binding:"required"`
}

func (h *Handler) saveWorkspace(c *gin.Context) {
	if !h.requireAppData(c) {
		return
	}
	var request saveWorkspaceRequest
	if err := c.ShouldBindJSON(&request); err != nil || !json.Valid(request.State) {
		writeRequestError(c, err)
		return
	}
	if err := h.appData.SaveWorkspace(c.Param("windowId"), request.VaultID, request.State); err != nil {
		writeError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) appSettings(c *gin.Context) {
	if !h.requireAppData(c) {
		return
	}
	settings, err := h.appData.Settings()
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, settings)
}

type putAppSettingRequest struct {
	Value json.RawMessage `json:"value" binding:"required"`
}

func (h *Handler) putAppSetting(c *gin.Context) {
	if !h.requireAppData(c) {
		return
	}
	var request putAppSettingRequest
	if err := c.ShouldBindJSON(&request); err != nil || !json.Valid(request.Value) {
		writeRequestError(c, err)
		return
	}
	if err := h.appData.PutSetting(c.Param("key"), request.Value); err != nil {
		writeError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) requireAppData(c *gin.Context) bool {
	if h.appData != nil {
		return true
	}
	c.JSON(http.StatusServiceUnavailable, gin.H{"code": "app_data_unavailable", "error": "app data storage is unavailable"})
	return false
}

func (h *Handler) requireDesktopToken(c *gin.Context) {
	if h.desktopToken == "" {
		c.Next()
		return
	}
	provided := c.GetHeader("X-Flux-Desktop-Token")
	if len(provided) != len(h.desktopToken) || subtle.ConstantTimeCompare([]byte(provided), []byte(h.desktopToken)) != 1 {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"code": "unauthorized", "error": "invalid desktop session token"})
		return
	}
	c.Next()
}

func (h *Handler) listFiles(c *gin.Context) {
	entries, err := h.app.ListFiles(c.Param("vaultId"))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, entries)
}

func (h *Handler) listFileChildren(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "250"))
	entries, next, err := h.app.ListFileChildren(c.Param("vaultId"), c.Query("parent"), c.Query("cursor"), limit)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"entries": entries, "nextCursor": next})
}

func (h *Handler) graph(c *gin.Context) {
	graph, err := h.app.Graph(c.Param("vaultId"))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, graph)
}

func (h *Handler) search(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	results, err := h.app.SearchPage(
		c.Param("vaultId"), c.Query("q"), limit, offset, c.Query("matchCase") == "true",
	)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, results)
}

func (h *Handler) references(c *gin.Context) {
	if c.Query("path") == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": "path_required", "error": "path is required"})
		return
	}
	result, err := h.app.DocumentReferences(
		c.Param("vaultId"), c.Query("path"), c.Query("includeUnlinked") == "true",
	)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) facets(c *gin.Context) {
	result, err := h.app.VaultFacets(c.Param("vaultId"))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) fileMetadata(c *gin.Context) {
	entry, err := h.app.FileMetadata(c.Param("vaultId"), c.Query("path"))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, entry)
}

func (h *Handler) vaultRevision(c *gin.Context) {
	change, err := h.app.VaultChanges(c.Param("vaultId"), 0)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, change)
}

func (h *Handler) rebuildIndex(c *gin.Context) {
	if err := h.app.RebuildIndex(c.Param("vaultId")); err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusAccepted, gin.H{"accepted": true})
}

func (h *Handler) vaultEvents(c *gin.Context) {
	vaultID := c.Param("vaultId")
	revision, err := h.app.VaultRevision(vaultID)
	if err != nil {
		writeError(c, err)
		return
	}
	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "stream_unsupported", "error": "streaming is unavailable"})
		return
	}
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")

	initial, changeErr := h.app.VaultChanges(vaultID, revision)
	if changeErr != nil {
		writeError(c, changeErr)
		return
	}
	c.SSEvent("revision", initial)
	flusher.Flush()
	for c.Request.Context().Err() == nil {
		next, waitErr := h.app.WaitVaultRevision(c.Request.Context(), vaultID, revision)
		if waitErr != nil || c.Request.Context().Err() != nil {
			return
		}
		if next == revision {
			continue
		}
		change, changeErr := h.app.VaultChanges(vaultID, revision)
		if changeErr != nil {
			return
		}
		revision = change.Revision
		c.SSEvent("revision", change)
		flusher.Flush()
	}
}

func (h *Handler) readFile(c *gin.Context) {
	document, err := h.app.ReadFile(c.Param("vaultId"), c.Query("path"))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, document)
}

func (h *Handler) readRawFile(c *gin.Context) {
	content, err := h.app.ReadRawFile(c.Param("vaultId"), c.Query("path"))
	if err != nil {
		writeError(c, err)
		return
	}
	c.Data(http.StatusOK, http.DetectContentType(content), content)
}

type saveFileRequest struct {
	Path         string `json:"path" binding:"required"`
	Content      string `json:"content"`
	ExpectedHash string `json:"expectedHash"`
}

func (h *Handler) saveFile(c *gin.Context) {
	var request saveFileRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		writeRequestError(c, err)
		return
	}
	result, err := h.app.SaveFile(
		c.Param("vaultId"),
		request.Path,
		request.Content,
		request.ExpectedHash,
	)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

type patchFileRequest struct {
	Path         string            `json:"path" binding:"required"`
	ExpectedHash string            `json:"expectedHash" binding:"required"`
	Edits        []domain.TextEdit `json:"edits" binding:"required,min=1"`
}

func (h *Handler) patchFile(c *gin.Context) {
	var request patchFileRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		writeRequestError(c, err)
		return
	}
	result, err := h.app.PatchFile(c.Param("vaultId"), request.Path, request.ExpectedHash, request.Edits)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

type moveFileRequest struct {
	SourcePath      string `json:"sourcePath" binding:"required"`
	DestinationPath string `json:"destinationPath" binding:"required"`
	ExpectedHash    string `json:"expectedHash"`
}

func (h *Handler) moveFile(c *gin.Context) {
	var request moveFileRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		writeRequestError(c, err)
		return
	}
	var entry domain.FileEntry
	var err error
	if request.ExpectedHash == "" {
		entry, err = h.app.MoveFile(c.Param("vaultId"), request.SourcePath, request.DestinationPath)
	} else {
		entry, err = h.app.MoveFileExpected(c.Param("vaultId"), request.SourcePath, request.DestinationPath, request.ExpectedHash)
	}
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, entry)
}

func (h *Handler) deleteFile(c *gin.Context) {
	var entry domain.TrashEntry
	var err error
	if expectedHash := c.Query("expectedHash"); expectedHash == "" {
		entry, err = h.app.DeleteFile(c.Param("vaultId"), c.Query("path"))
	} else {
		entry, err = h.app.DeleteFileExpected(c.Param("vaultId"), c.Query("path"), expectedHash)
	}
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, entry)
}

type restoreFileRequest struct {
	TrashID string `json:"trashId" binding:"required"`
}

func (h *Handler) restoreFile(c *gin.Context) {
	var request restoreFileRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		writeRequestError(c, err)
		return
	}
	entry, err := h.app.RestoreFile(c.Param("vaultId"), request.TrashID)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, entry)
}

func (h *Handler) listTrash(c *gin.Context) {
	entries, err := h.app.ListTrash(c.Param("vaultId"))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, entries)
}

func (h *Handler) permanentlyDelete(c *gin.Context) {
	if c.Query("confirm") != "true" {
		c.JSON(http.StatusBadRequest, gin.H{"code": "confirmation_required", "error": "permanent deletion requires confirm=true"})
		return
	}
	if err := h.app.PermanentlyDelete(c.Param("vaultId"), c.Param("trashId")); err != nil {
		writeError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) purgeTrash(c *gin.Context) {
	if c.Query("confirm") != "true" {
		c.JSON(http.StatusBadRequest, gin.H{"code": "confirmation_required", "error": "trash purge requires confirm=true"})
		return
	}
	days, err := strconv.Atoi(c.Query("olderThanDays"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "invalid_retention", "error": "olderThanDays must be 7, 30, or 90"})
		return
	}
	result, err := h.app.PurgeTrash(c.Param("vaultId"), days)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) listModelProviders(c *gin.Context) {
	if h.modelProviders == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "model providers service not available"})
		return
	}
	providers := h.modelProviders.ListProviders()
	c.JSON(http.StatusOK, providers)
}

func (h *Handler) getModelProvider(c *gin.Context) {
	if h.modelProviders == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "model providers service not available"})
		return
	}
	provider, err := h.modelProviders.GetProvider(c.Param("providerId"))
	if err != nil {
		if errors.Is(err, modelproviders.ErrProviderNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"code": "provider_not_found", "error": err.Error()})
		} else {
			writeError(c, err)
		}
		return
	}
	c.JSON(http.StatusOK, provider)
}

func (h *Handler) updateModelProvider(c *gin.Context) {
	if h.modelProviders == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "model providers service not available"})
		return
	}
	var config map[string]interface{}
	if err := c.ShouldBindJSON(&config); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "invalid_config", "error": err.Error()})
		return
	}
	if err := h.modelProviders.UpdateProvider(c.Param("providerId"), config); err != nil {
		if errors.Is(err, modelproviders.ErrProviderNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"code": "provider_not_found", "error": err.Error()})
		} else {
			writeError(c, err)
		}
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) listAIRuntimes(c *gin.Context) {
	if h.modelProviders == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "model providers service not available"})
		return
	}
	runtimes := h.modelProviders.ListRuntimes()
	c.JSON(http.StatusOK, runtimes)
}

func (h *Handler) getAIRuntime(c *gin.Context) {
	if h.modelProviders == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "model providers service not available"})
		return
	}
	runtime, err := h.modelProviders.GetRuntime(c.Param("runtimeId"))
	if err != nil {
		if errors.Is(err, modelproviders.ErrProviderNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"code": "runtime_not_found", "error": err.Error()})
		} else {
			writeError(c, err)
		}
		return
	}
	c.JSON(http.StatusOK, runtime)
}

func writeError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, vault.ErrNotConfigured):
		c.JSON(http.StatusConflict, gin.H{"code": "vault_not_configured", "error": err.Error()})
	case errors.Is(err, vault.ErrVaultInUse):
		c.JSON(http.StatusConflict, gin.H{"code": "vault_in_use", "error": err.Error()})
	case errors.Is(err, vault.ErrDuplicateID):
		c.JSON(http.StatusConflict, gin.H{"code": "duplicate_vault_identity", "error": err.Error()})
	case errors.Is(err, vault.ErrPathRequired):
		c.JSON(http.StatusBadRequest, gin.H{"code": "vault_path_required", "error": err.Error()})
	case errors.Is(err, vault.ErrNotOpen):
		c.JSON(http.StatusNotFound, gin.H{"code": "vault_not_open", "error": err.Error()})
	case errors.Is(err, vault.ErrVaultMismatch), errors.Is(err, vault.ErrNestedVault), errors.Is(err, files.ErrInvalidPath):
		c.JSON(http.StatusBadRequest, gin.H{"code": "invalid_path", "error": err.Error()})
	case errors.Is(err, files.ErrUnsupportedPath):
		c.JSON(http.StatusBadRequest, gin.H{"code": "unsupported_file", "error": err.Error()})
	case errors.Is(err, files.ErrConflict):
		c.JSON(http.StatusConflict, gin.H{"code": "file_conflict", "error": err.Error()})
	case errors.Is(err, files.ErrInvalidEdit):
		c.JSON(http.StatusBadRequest, gin.H{"code": "invalid_edit", "error": err.Error()})
	case errors.Is(err, files.ErrRetention):
		c.JSON(http.StatusBadRequest, gin.H{"code": "invalid_retention", "error": err.Error()})
	case errors.Is(err, application.ErrInvalidVaultPlan):
		c.JSON(http.StatusBadRequest, gin.H{"code": "invalid_vault_plan", "error": err.Error()})
	case errors.Is(err, gitadapter.ErrNotRepository), errors.Is(err, gitadapter.ErrMessageNeeded), errors.Is(err, gitadapter.ErrInvalidPath):
		c.JSON(http.StatusBadRequest, gin.H{"code": "git_request_failed", "error": err.Error()})
	default:
		var gitError *gitadapter.CommandError
		if errors.As(err, &gitError) {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"code": "git_command_failed", "error": gitError.Error()})
			return
		}
		if errors.Is(err, os.ErrExist) {
			c.JSON(http.StatusConflict, gin.H{"code": "path_exists", "error": "destination already exists"})
			return
		}
		if errors.Is(err, os.ErrNotExist) {
			c.JSON(http.StatusNotFound, gin.H{"code": "file_not_found", "error": "file not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": "internal_error", "error": "internal server error"})
	}
}

func limitRequestBody(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxRequestBodyBytes)
	c.Next()
}

func writeRequestError(c *gin.Context, err error) {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"code": "request_too_large", "error": "request body exceeds 50 MiB"})
		return
	}
	c.JSON(http.StatusBadRequest, gin.H{"code": "invalid_request", "error": "invalid request body"})
}
