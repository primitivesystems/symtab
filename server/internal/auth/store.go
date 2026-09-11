// Package auth protects a single-owner web deployment. Desktop authentication stays separate.
package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"net/url"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"golang.org/x/crypto/argon2"
	"gorm.io/gorm"
)

type owner struct {
	ID           uint `gorm:"primaryKey"`
	Username     string
	Salt         []byte
	PasswordHash []byte
}

type credential struct {
	Hash       string    `gorm:"primaryKey" json:"-"`
	ID         string    `gorm:"uniqueIndex" json:"id"`
	Kind       string    `json:"kind"`
	Name       string    `json:"name"`
	CreatedAt  time.Time `json:"createdAt"`
	ExpiresAt  time.Time `gorm:"index" json:"expiresAt"`
	LastUsedAt time.Time `json:"lastUsedAt"`
}

type Service struct {
	db               *gorm.DB
	origin, setupKey string
	secure           bool
	mu               sync.Mutex
	attempts         int
	window           time.Time
}

func New(db *gorm.DB, origin, setupKey string) (*Service, error) {
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" ||
		(u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1" || u.Hostname() == "::1"))) {
		return nil, errors.New("web authentication requires an HTTPS origin (HTTP is allowed only on loopback)")
	}
	if err := db.AutoMigrate(&owner{}, &credential{}); err != nil {
		return nil, err
	}
	s := &Service{db: db, origin: origin, setupKey: setupKey, secure: u.Scheme == "https"}
	var count int64
	if err := db.Model(&owner{}).Count(&count).Error; err != nil {
		return nil, err
	}
	if count == 0 && len(setupKey) < 32 {
		return nil, errors.New("set FLUX_SETUP_KEY to at least 32 random characters before first startup")
	}
	return s, nil
}

func passwordHash(password string, salt []byte) []byte {
	return argon2.IDKey([]byte(password), salt, 2, 19*1024, 1, 32)
}

func validPassword(password string) bool {
	return utf8.ValidString(password) && utf8.RuneCountInString(password) >= 15 && len(password) <= 128
}

func digest(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func randomValue() (string, error) {
	value := make([]byte, 32)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return hex.EncodeToString(value), nil
}

func same(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(digest(a)), []byte(digest(b))) == 1
}

// Called with mu held: one bounded attempt budget for this single-owner instance.
func (s *Service) allowAttempt() bool {
	if time.Since(s.window) >= time.Minute {
		s.window = time.Now()
		s.attempts = 0
	}
	s.attempts++
	return s.attempts <= 10
}

func (s *Service) verifyPassword(username, password string) bool {
	var user owner
	if s.db.First(&user, 1).Error != nil {
		return false
	}
	candidate := passwordHash(password, user.Salt)
	return subtle.ConstantTimeCompare(candidate, user.PasswordHash) == 1 && same(username, user.Username)
}

func (s *Service) issue(kind, name string) (string, error) {
	raw, err := randomValue()
	if err != nil {
		return "", err
	}
	id, err := randomValue()
	if err != nil {
		return "", err
	}
	raw = "flux_" + raw
	now := time.Now().UTC()
	ttl := 7 * 24 * time.Hour
	if kind == "api" {
		ttl = 90 * 24 * time.Hour
	}
	row := credential{Hash: digest(raw), ID: id, Kind: kind, Name: name, CreatedAt: now, LastUsedAt: now, ExpiresAt: now.Add(ttl)}
	err = s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("expires_at <= ? OR (kind = ? AND last_used_at < ?)", now, "session", now.Add(-30*time.Minute)).Delete(&credential{}).Error; err != nil {
			return err
		}
		var count int64
		if err := tx.Model(&credential{}).Where("kind = ?", kind).Count(&count).Error; err != nil {
			return err
		}
		if count >= 100 {
			return errors.New("credential limit reached; revoke unused credentials")
		}
		return tx.Create(&row).Error
	})
	return raw, err
}

func (s *Service) lookup(raw, kind string) (credential, error) {
	var row credential
	if len(raw) != 69 || !strings.HasPrefix(raw, "flux_") {
		return row, errors.New("invalid credential")
	}
	now := time.Now().UTC()
	err := s.db.Where("hash = ? AND kind = ? AND expires_at > ?", digest(raw), kind, now).Take(&row).Error
	if err != nil {
		return row, err
	}
	if kind == "session" && now.Sub(row.LastUsedAt) > 30*time.Minute {
		return row, errors.New("session expired")
	}
	return row, nil
}
