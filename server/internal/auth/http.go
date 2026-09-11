package auth

import (
	"context"
	"crypto/rand"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func fail(c *gin.Context, status int, message string) {
	c.AbortWithStatusJSON(status, gin.H{"error": message})
}

func (s *Service) cookieName() string {
	if s.secure {
		return "__Host-flux-session"
	}
	return "flux-session"
}

func (s *Service) setCookie(c *gin.Context, value string, age int) {
	http.SetCookie(c.Writer, &http.Cookie{Name: s.cookieName(), Value: value, Path: "/", MaxAge: age,
		HttpOnly: true, Secure: s.secure, SameSite: http.SameSiteStrictMode})
}

func (s *Service) browserWrite(c *gin.Context) bool {
	if c.Request.Method == "GET" || c.Request.Method == "HEAD" {
		return true
	}
	if c.GetHeader("Origin") != s.origin || c.GetHeader("Sec-Fetch-Site") == "cross-site" {
		fail(c, 403, "Request origin is not allowed")
		return false
	}
	return true
}

// Protect authenticates every API route, including streams. API tokens never become sessions.
func (s *Service) Protect(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	raw, _ := c.Cookie(s.cookieName())
	kind := "session"
	if authorization := c.GetHeader("Authorization"); authorization != "" {
		if !strings.HasPrefix(authorization, "Bearer ") {
			fail(c, 401, "Authentication required")
			return
		}
		raw, kind = strings.TrimPrefix(authorization, "Bearer "), "api"
	} else if !s.browserWrite(c) {
		return
	}
	row, err := s.lookup(raw, kind)
	if err != nil {
		fail(c, 401, "Authentication required")
		return
	}
	stream := strings.HasSuffix(c.FullPath(), "/events")
	if !stream && c.FullPath() != "/api/v1/auth/status" && c.FullPath() != "/api/v1/status" && time.Since(row.LastUsedAt) >= time.Minute {
		if err := s.db.Model(&row).Update("last_used_at", time.Now().UTC()).Error; err != nil {
			fail(c, 503, "Session storage unavailable")
			return
		}
	}
	if stream {
		ctx, cancel := context.WithCancel(c.Request.Context())
		defer cancel()
		c.Request = c.Request.WithContext(ctx)
		go func() {
			ticker := time.NewTicker(15 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					if _, err := s.lookup(raw, kind); err != nil {
						cancel()
						return
					}
				}
			}
		}()
	}
	c.Set("credential", row)
	c.Next()
}

func (s *Service) Register(router *gin.Engine) {
	routes := router.Group("/api/v1/auth")
	routes.Use(func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
		if !s.browserWrite(c) {
			return
		}
		c.Next()
	})
	routes.GET("/status", s.status)
	routes.POST("/setup", s.setup)
	routes.POST("/login", s.login)
	routes.Use(s.Protect, func(c *gin.Context) {
		row := c.MustGet("credential").(credential)
		if row.Kind != "session" {
			fail(c, 403, "Sign in to manage account security")
			return
		}
		c.Next()
	})
	routes.POST("/logout", s.logout)
	routes.GET("/credentials", s.listCredentials)
	routes.POST("/tokens", s.createToken)
	routes.DELETE("/credentials/:id", s.revoke)
	routes.POST("/password", s.changePassword)
}

func (s *Service) status(c *gin.Context) {
	var count int64
	if err := s.db.Model(&owner{}).Count(&count).Error; err != nil {
		fail(c, 503, "Account storage unavailable")
		return
	}
	response := gin.H{"enabled": true, "setupRequired": count == 0, "authenticated": false}
	raw, _ := c.Cookie(s.cookieName())
	if row, err := s.lookup(raw, "session"); err == nil {
		var user owner
		if s.db.First(&user, 1).Error != nil {
			fail(c, 503, "Account storage unavailable")
			return
		}
		response["authenticated"], response["username"], response["sessionId"] = true, user.Username, row.ID
	}
	c.JSON(200, response)
}

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
	SetupKey string `json:"setupKey"`
}

func (s *Service) attempt(c *gin.Context) bool {
	if !s.allowAttempt() {
		c.Header("Retry-After", "60")
		fail(c, 429, "Too many attempts. Try again in a minute.")
		return false
	}
	return true
}

func (s *Service) finishLogin(c *gin.Context) {
	raw, err := s.issue("session", "Browser session")
	if err != nil {
		fail(c, 503, "Could not create session. Revoke unused sessions if the limit is reached.")
		return
	}
	if old, err := c.Cookie(s.cookieName()); err == nil {
		if err := s.db.Where("hash = ? AND kind = ?", digest(old), "session").Delete(&credential{}).Error; err != nil {
			fail(c, 503, "Could not rotate session")
			return
		}
	}
	s.setCookie(c, raw, 7*24*60*60)
	c.Status(204)
}

func (s *Service) setup(c *gin.Context) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.attempt(c) {
		return
	}
	var request loginRequest
	if c.ShouldBindJSON(&request) != nil {
		fail(c, 400, "Invalid setup request")
		return
	}
	if len(s.setupKey) < 32 || !same(request.SetupKey, s.setupKey) {
		fail(c, 403, "Invalid setup key")
		return
	}
	var count int64
	if err := s.db.Model(&owner{}).Count(&count).Error; err != nil {
		fail(c, 503, "Account storage unavailable")
		return
	}
	if count != 0 {
		fail(c, 409, "Owner already configured. Sign in instead.")
		return
	}
	username := strings.TrimSpace(request.Username)
	if !regexp.MustCompile(`^[A-Za-z0-9_.@-]{3,64}$`).MatchString(username) || !validPassword(request.Password) {
		fail(c, 400, "Use a 3–64 character username and a 15–128 byte password")
		return
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		fail(c, 503, "Could not create account")
		return
	}
	if err := s.db.Create(&owner{ID: 1, Username: username, Salt: salt, PasswordHash: passwordHash(request.Password, salt)}).Error; err != nil {
		fail(c, 503, "Could not create account")
		return
	}
	s.setupKey = ""
	s.finishLogin(c)
}

func (s *Service) login(c *gin.Context) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.attempt(c) {
		return
	}
	var request loginRequest
	if c.ShouldBindJSON(&request) != nil || !validPassword(request.Password) || len(request.Username) > 64 ||
		!s.verifyPassword(strings.TrimSpace(request.Username), request.Password) {
		fail(c, 401, "Invalid username or password")
		return
	}
	s.finishLogin(c)
}

func (s *Service) logout(c *gin.Context) {
	row := c.MustGet("credential").(credential)
	if err := s.db.Delete(&row).Error; err != nil {
		fail(c, 503, "Could not sign out")
		return
	}
	s.setCookie(c, "", -1)
	c.Status(204)
}

func (s *Service) listCredentials(c *gin.Context) {
	rows := []credential{}
	now := time.Now().UTC()
	if err := s.db.Where("expires_at > ? AND (kind = ? OR last_used_at > ?)", now, "api", now.Add(-30*time.Minute)).Order("created_at DESC").Find(&rows).Error; err != nil {
		fail(c, 503, "Could not list credentials")
		return
	}
	c.JSON(200, rows)
}

func (s *Service) createToken(c *gin.Context) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var request struct {
		Name string `json:"name"`
	}
	if c.ShouldBindJSON(&request) != nil || len(strings.TrimSpace(request.Name)) == 0 || len(request.Name) > 80 {
		fail(c, 400, "Enter a token name (1–80 characters)")
		return
	}
	raw, err := s.issue("api", strings.TrimSpace(request.Name))
	if err != nil {
		fail(c, 503, "Could not create token. Revoke unused tokens if the limit is reached.")
		return
	}
	c.JSON(201, gin.H{"token": raw})
}

func (s *Service) revoke(c *gin.Context) {
	if err := s.db.Where("id = ?", c.Param("id")).Delete(&credential{}).Error; err != nil {
		fail(c, 503, "Could not revoke credential")
		return
	}
	c.Status(204)
}

func (s *Service) changePassword(c *gin.Context) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.attempt(c) {
		return
	}
	var request struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if c.ShouldBindJSON(&request) != nil || !validPassword(request.NewPassword) || len(request.CurrentPassword) > 128 {
		fail(c, 400, "Use a password between 15 and 128 bytes")
		return
	}
	var user owner
	if s.db.First(&user, 1).Error != nil || !s.verifyPassword(user.Username, request.CurrentPassword) {
		fail(c, 401, "Invalid current password")
		return
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		fail(c, 503, "Could not change password")
		return
	}
	hash := passwordHash(request.NewPassword, salt)
	if err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&user).Updates(map[string]any{"salt": salt, "password_hash": hash}).Error; err != nil {
			return err
		}
		return tx.Where("1 = 1").Delete(&credential{}).Error
	}); err != nil {
		fail(c, 503, "Could not change password")
		return
	}
	s.setCookie(c, "", -1)
	c.Status(204)
}
