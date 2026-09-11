package api

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestBrowserOriginGuard(t *testing.T) {
	for _, tc := range []struct {
		origin, site string
		want         int
	}{
		{"https://flux.example", "same-origin", 204},
		{"https://evil.example", "", 403},
		{"null", "", 403},
		{"", "cross-site", 403},
		{"", "", 204}, // Native clients do not send Origin.
	} {
		router := gin.New()
		router.Use(BrowserOriginGuard("https://flux.example"))
		router.POST("/write", func(c *gin.Context) { c.Status(204) })
		request := httptest.NewRequest(http.MethodPost, "/write", nil)
		request.Header.Set("Origin", tc.origin)
		request.Header.Set("Sec-Fetch-Site", tc.site)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != tc.want {
			t.Fatalf("origin %q site %q: got %d want %d", tc.origin, tc.site, response.Code, tc.want)
		}
	}
}
