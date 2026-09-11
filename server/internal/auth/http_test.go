package auth

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/flux-pkm/server/internal/appdata"
	"github.com/gin-gonic/gin"
)

func TestOwnerLifecycle(t *testing.T) {
	store, err := appdata.Open(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	service, err := New(store.Database(), "https://flux.example", strings.Repeat("s", 32))
	if err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	service.Register(router)
	router.GET("/private", service.Protect, func(c *gin.Context) { c.Status(204) })
	router.POST("/private", service.Protect, func(c *gin.Context) { c.Status(204) })
	call := func(method, path, body, cookie, bearer, origin string, status int) *httptest.ResponseRecorder {
		t.Helper()
		request := httptest.NewRequest(method, path, strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		if cookie != "" {
			request.AddCookie(&http.Cookie{Name: service.cookieName(), Value: cookie})
		}
		if bearer != "" {
			request.Header.Set("Authorization", "Bearer "+bearer)
		}
		if origin != "" {
			request.Header.Set("Origin", origin)
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != status {
			t.Fatalf("%s %s: got %d, want %d: %s", method, path, response.Code, status, response.Body.String())
		}
		return response
	}
	origin := "https://flux.example"
	call("GET", "/private", "", "", "", "", 401)
	call("POST", "/api/v1/auth/setup", `{"username":"owner","password":"a long test password","setupKey":"wrong"}`, "", "", origin, 403)
	body := `{"username":"owner","password":"a long test password","setupKey":"` + strings.Repeat("s", 32) + `"}`
	response := call("POST", "/api/v1/auth/setup", body, "", "", origin, 204)
	cookies := response.Result().Cookies()
	if len(cookies) != 1 || !cookies[0].HttpOnly || !cookies[0].Secure || cookies[0].SameSite != http.SameSiteStrictMode || cookies[0].Path != "/" {
		t.Fatal("unsafe session cookie")
	}
	session := cookies[0].Value
	call("POST", "/api/v1/auth/setup", body, "", "", origin, 403)
	call("GET", "/private", "", session, "", "", 204)
	call("POST", "/private", `{}`, session, "", "", 403)
	call("POST", "/private", `{}`, session, "", "https://evil.example", 403)
	call("POST", "/private", `{}`, session, "", origin, 204)
	minted := call("POST", "/api/v1/auth/tokens", `{"name":"Integration"}`, session, "", origin, 201)
	var token struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(minted.Body.Bytes(), &token); err != nil {
		t.Fatal(err)
	}
	call("POST", "/private", `{}`, "", token.Token, "", 204)
	call("GET", "/private", "", "", session, "", 401) // A session is not an API key.
	call("GET", "/private", "", token.Token, "", "", 401)
	call("GET", "/api/v1/auth/credentials", "", "", token.Token, "", 403)
	rows := []credential{}
	listed := call("GET", "/api/v1/auth/credentials", "", session, "", "", 200)
	if strings.Contains(listed.Body.String(), token.Token) || strings.Contains(listed.Body.String(), digest(token.Token)) {
		t.Fatal("credential secret leaked")
	}
	if err := json.Unmarshal(listed.Body.Bytes(), &rows); err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		if row.Kind == "api" {
			call("DELETE", "/api/v1/auth/credentials/"+row.ID, "", session, "", origin, 204)
		}
	}
	call("GET", "/private", "", "", token.Token, "", 401)
	call("POST", "/api/v1/auth/logout", "", session, "", origin, 204)
	call("GET", "/private", "", session, "", "", 401)
	login := `{"username":"owner","password":"a long test password"}`
	response = call("POST", "/api/v1/auth/login", login, "", "", origin, 204)
	session = response.Result().Cookies()[0].Value
	if err := store.Database().Model(&credential{}).Where("hash = ?", digest(session)).Update("last_used_at", time.Now().Add(-31*time.Minute)).Error; err != nil {
		t.Fatal(err)
	}
	call("GET", "/private", "", session, "", "", 401)
	response = call("POST", "/api/v1/auth/login", login, "", "", origin, 204)
	session = response.Result().Cookies()[0].Value
	call("POST", "/api/v1/auth/password", `{"currentPassword":"a long test password","newPassword":"another long test password"}`, session, "", origin, 204)
	call("GET", "/private", "", session, "", "", 401)
	call("POST", "/api/v1/auth/login", login, "", "", origin, 401)
	call("POST", "/api/v1/auth/login", `{"username":"owner","password":"another long test password"}`, "", "", origin, 204)
	// Persisted owner permits restart without retaining the setup key.
	if _, err := New(store.Database(), origin, ""); err != nil {
		t.Fatal(err)
	}
	service.attempts = 10
	service.window = time.Now()
	call("POST", "/api/v1/auth/login", login, "", "", origin, 429)
}

func TestStreamStopsAfterRevocation(t *testing.T) {
	store, err := appdata.Open(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	service, err := New(store.Database(), "https://flux.example", strings.Repeat("s", 32))
	if err != nil {
		t.Fatal(err)
	}
	token, err := service.issue("api", "stream check")
	if err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	router.GET("/events", service.Protect, func(c *gin.Context) {
		c.Header("Content-Type", "text/event-stream")
		c.Writer.WriteHeader(200)
		c.Writer.Flush()
		<-c.Request.Context().Done()
	})
	server := httptest.NewServer(router)
	defer server.Close()
	request, _ := http.NewRequest("GET", server.URL+"/events", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatal("stream not authenticated")
	}
	if err := store.Database().Where("hash = ?", digest(token)).Delete(&credential{}).Error; err != nil {
		t.Fatal(err)
	}
	ended := make(chan struct{})
	go func() { _, _ = io.ReadAll(response.Body); close(ended) }()
	select {
	case <-ended:
	case <-time.After(20 * time.Second):
		t.Fatal("revoked credential retained stream access")
	}
}

func TestRefuseUnsafeBootstrap(t *testing.T) {
	store, err := appdata.Open(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	for _, origin := range []string{"http://public.example", "https://flux.example/", "https://user@flux.example"} {
		if _, err := New(store.Database(), origin, strings.Repeat("k", 32)); err == nil {
			t.Fatalf("accepted %s", origin)
		}
	}
	if _, err := New(store.Database(), "https://flux.example", ""); err == nil {
		t.Fatal("accepted unprotected first-owner setup")
	}
}
