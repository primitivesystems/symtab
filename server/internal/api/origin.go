package api

import (
	"github.com/gin-gonic/gin"
	"net/http"
)

// BrowserOriginGuard complements proxy authentication; CORS alone does not stop writes.
func BrowserOriginGuard(allowedOrigin string) gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if c.GetHeader("Sec-Fetch-Site") == "cross-site" || (origin != "" && origin != allowedOrigin) {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"code": "forbidden_origin", "error": "request origin is not allowed"})
			return
		}
		c.Next()
	}
}
