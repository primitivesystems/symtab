package config

import (
	"os"
	"path/filepath"
)

type Config struct {
	Environment                string
	Host                       string
	VaultPath                  string
	VaultRoot                  string
	AllowedOrigin              string
	Port                       string
	AppDataDir                 string
	DesktopToken               string
	PluginRegistryURL          string
	PluginRegistrySignatureURL string
	PluginRegistryPublicKey    string
}

func Load() *Config {
	environment := getEnv("ENVIRONMENT", "development")
	appDataDir := getEnv("SYMTAB_APP_DATA_DIR", defaultAppDataDir())
	return &Config{
		Environment:                environment,
		Host:                       getEnv("HOST", defaultHost(environment)),
		VaultPath:                  os.Getenv("SYMTAB_VAULT_PATH"),
		VaultRoot:                  defaultVaultRoot(environment, appDataDir),
		AllowedOrigin:              getEnv("CORS_ALLOWED_ORIGIN", "http://localhost:3000"),
		Port:                       getEnv("PORT", "8080"),
		AppDataDir:                 appDataDir,
		DesktopToken:               os.Getenv("SYMTAB_DESKTOP_TOKEN"),
		PluginRegistryURL:          os.Getenv("SYMTAB_PLUGIN_REGISTRY_URL"),
		PluginRegistrySignatureURL: os.Getenv("SYMTAB_PLUGIN_REGISTRY_SIGNATURE_URL"),
		PluginRegistryPublicKey:    os.Getenv("SYMTAB_PLUGIN_REGISTRY_PUBLIC_KEY"),
	}
}

func defaultVaultRoot(environment, appDataDir string) string {
	if configured := os.Getenv("SYMTAB_VAULT_ROOT"); configured != "" {
		return configured
	}
	if environment == "production" && os.Getenv("SYMTAB_VAULT_PATH") == "" {
		return "/data/vaults"
	}
	if environment == "development" && os.Getenv("SYMTAB_VAULT_PATH") == "" {
		return filepath.Join(appDataDir, "vaults")
	}
	return ""
}

func defaultAppDataDir() string {
	if directory, err := os.UserConfigDir(); err == nil {
		return filepath.Join(directory, "Symtab")
	}
	return filepath.Join(os.TempDir(), "symtab-app-data")
}

func defaultHost(environment string) string {
	if environment == "production" {
		return "0.0.0.0"
	}
	return "127.0.0.1"
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
