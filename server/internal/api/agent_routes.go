package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/symtab-pkm/server/internal/agent"
	"github.com/gin-gonic/gin"
)

func (h *Handler) registerAgentRoutes(v1 *gin.RouterGroup) {
	v1.GET("/agent/providers", h.listAgentProviders)
	v1.POST("/agent/threads", h.createAgentThread)
	v1.GET("/agent/threads", h.listAgentThreads)
	v1.GET("/agent/threads/:threadId", h.getAgentThread)
	v1.PATCH("/agent/threads/:threadId", h.renameAgentThread)
	v1.PUT("/agent/threads/:threadId/configuration", h.updateAgentThreadConfiguration)
	v1.DELETE("/agent/threads/:threadId", h.deleteAgentThread)
	v1.POST("/agent/threads/:threadId/turns", h.startAgentTurn)
	v1.POST("/agent/threads/:threadId/turns/:turnId/interrupt", h.interruptAgentTurn)
	v1.POST("/agent/threads/:threadId/approvals/:requestId", h.respondAgentApproval)
	v1.GET("/agent/threads/:threadId/events", h.agentEvents)
	v1.GET("/agent/threads/:threadId/events/history", h.agentEventHistory)
}

func (h *Handler) renameAgentThread(c *gin.Context) {
	var request struct {
		Title string `json:"title"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		writeRequestError(c, err)
		return
	}
	thread, err := h.agent.RenameThread(c.Param("threadId"), request.Title)
	if err != nil {
		writeAgentError(c, err)
		return
	}
	c.JSON(http.StatusOK, thread)
}

func (h *Handler) updateAgentThreadConfiguration(c *gin.Context) {
	var configuration agent.Configuration
	if err := c.ShouldBindJSON(&configuration); err != nil {
		writeRequestError(c, err)
		return
	}
	thread, err := h.agent.UpdateConfiguration(c.Param("threadId"), configuration)
	if err != nil {
		writeAgentError(c, err)
		return
	}
	c.JSON(http.StatusOK, thread)
}

func (h *Handler) listAgentProviders(c *gin.Context) {
	c.JSON(http.StatusOK, agent.Providers())
}

func (h *Handler) createAgentThread(c *gin.Context) {
	var request agent.CreateThreadRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		writeRequestError(c, err)
		return
	}
	thread, err := h.agent.CreateThread(request)
	if err != nil {
		writeAgentError(c, err)
		return
	}
	c.JSON(http.StatusCreated, thread)
}

func (h *Handler) listAgentThreads(c *gin.Context) {
	threads, err := h.agent.Threads(c.Query("vaultId"))
	if err != nil {
		writeAgentError(c, err)
		return
	}
	c.JSON(http.StatusOK, threads)
}

func (h *Handler) getAgentThread(c *gin.Context) {
	thread, err := h.agent.Thread(c.Param("threadId"))
	if err != nil {
		writeAgentError(c, err)
		return
	}
	c.JSON(http.StatusOK, thread)
}

func (h *Handler) deleteAgentThread(c *gin.Context) {
	if err := h.agent.DeleteThread(c.Param("threadId")); err != nil {
		writeAgentError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) startAgentTurn(c *gin.Context) {
	var request agent.StartTurnRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		writeRequestError(c, err)
		return
	}
	turn, err := h.agent.StartTurn(c.Param("threadId"), request)
	if err != nil {
		writeAgentError(c, err)
		return
	}
	c.JSON(http.StatusAccepted, turn)
}

func (h *Handler) interruptAgentTurn(c *gin.Context) {
	if err := h.agent.InterruptTurn(c.Param("threadId"), c.Param("turnId")); err != nil {
		writeAgentError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

type approvalResponse struct {
	OptionID string `json:"optionId"`
}

func (h *Handler) respondAgentApproval(c *gin.Context) {
	var request approvalResponse
	if err := c.ShouldBindJSON(&request); err != nil {
		writeRequestError(c, err)
		return
	}
	if err := h.agent.RespondApproval(c.Param("threadId"), c.Param("requestId"), request.OptionID); err != nil {
		writeAgentError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) agentEvents(c *gin.Context) {
	sequence, err := strconv.ParseInt(c.DefaultQuery("after", "0"), 10, 64)
	if err != nil || sequence < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"code": "invalid_sequence", "error": "after must be a non-negative integer"})
		return
	}
	if lastEventID := c.GetHeader("Last-Event-ID"); lastEventID != "" {
		if parsed, parseErr := strconv.ParseInt(lastEventID, 10, 64); parseErr == nil && parsed > sequence {
			sequence = parsed
		}
	}
	if _, err := h.agent.Thread(c.Param("threadId")); err != nil {
		writeAgentError(c, err)
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
	for c.Request.Context().Err() == nil {
		events, waitErr := h.agent.WaitEvents(c.Request.Context(), c.Param("threadId"), sequence)
		if waitErr != nil {
			return
		}
		for _, event := range events {
			data, marshalErr := json.Marshal(event)
			if marshalErr != nil {
				return
			}
			if _, writeErr := fmt.Fprintf(c.Writer, "id: %d\nevent: agent\ndata: %s\n\n", event.Sequence, data); writeErr != nil {
				return
			}
			sequence = event.Sequence
		}
		flusher.Flush()
	}
}

func (h *Handler) agentEventHistory(c *gin.Context) {
	sequence, err := strconv.ParseInt(c.DefaultQuery("after", "0"), 10, 64)
	if err != nil || sequence < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"code": "invalid_sequence", "error": "after must be a non-negative integer"})
		return
	}
	events, err := h.agent.EventsAfter(c.Param("threadId"), sequence)
	if err != nil {
		writeAgentError(c, err)
		return
	}
	c.JSON(http.StatusOK, events)
}

func writeAgentError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, agent.ErrInvalidRequest):
		c.JSON(http.StatusBadRequest, gin.H{"code": "invalid_agent_request", "error": err.Error()})
	case errors.Is(err, agent.ErrNotFound), errors.Is(err, agent.ErrApprovalNotFound):
		c.JSON(http.StatusNotFound, gin.H{"code": "agent_resource_not_found", "error": err.Error()})
	case errors.Is(err, agent.ErrBusy):
		c.JSON(http.StatusConflict, gin.H{"code": "agent_thread_busy", "error": err.Error()})
	default:
		writeError(c, err)
	}
}
