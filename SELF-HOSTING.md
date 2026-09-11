# Flux Self-Hosting Guide

Complete deployment guide for running Flux on your own infrastructure using Docker.

## 📋 Prerequisites

- **Linux VM** with minimum specs:
  - 2 CPU cores
  - 4GB RAM
  - 20GB disk space
- **Docker Engine** with Compose plugin (version 20.10+)
- **Domain name** (for production HTTPS setup)
- **HTTPS reverse proxy** (Caddy, Nginx, Traefik, etc.)

## 🚀 Quick Start

### 1. Clone and Configure

```bash
# Clone the repository
git clone https://github.com/your-username/flux.git
cd flux

# Copy environment template
cp .env.selfhost .env
chmod 600 .env

# Generate setup key
openssl rand -hex 32
```

### 2. Configure Environment

Edit `.env` with your settings:

```bash
# Required settings
PUBLIC_URL=https://flux.yourdomain.com
FLUX_SETUP_KEY=<your-generated-key>
WEB_PORT=3000

# Optional: Plugin marketplace
FLUX_PLUGIN_REGISTRY_URL=
FLUX_PLUGIN_REGISTRY_SIGNATURE_URL=
FLUX_PLUGIN_REGISTRY_PUBLIC_KEY=
```

### 3. Start Services

```bash
# Validate configuration
docker compose -f docker-compose.selfhost.yml config --quiet

# Build and start
docker compose -f docker-compose.selfhost.yml up -d --build

# Check health
docker compose -f docker-compose.selfhost.yml ps
sh scripts/check-selfhost.sh
```

### 4. Initial Setup

1. Open `https://flux.yourdomain.com` in your browser
2. Enter your setup key
3. Create your owner account (username + 15+ character password)
4. Remove `FLUX_SETUP_KEY` from `.env` and restart:
   ```bash
   docker compose -f docker-compose.selfhost.yml up -d --force-recreate flux-server
   ```

## 🔒 Security Setup

### HTTPS Reverse Proxy

The web container binds only to `127.0.0.1:3000` for security. You must use an HTTPS reverse proxy:

#### Caddy (Recommended)

```caddyfile
flux.yourdomain.com {
    reverse_proxy 127.0.0.1:3000
}
```

#### Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name flux.yourdomain.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

#### Traefik

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.flux.rule=Host(`flux.yourdomain.com`)"
  - "traefik.http.routers.flux.entrypoints=websecure"
  - "traefik.http.services.flux.loadbalancer.server.port=3000"
```

### Firewall Configuration

```bash
# Allow SSH (customize port as needed)
ufw allow 22/tcp

# Allow HTTPS
ufw allow 443/tcp

# Allow HTTP for ACME challenges
ufw allow 80/tcp

# Block direct access to Flux ports
ufw deny 3000/tcp
ufw deny 8080/tcp

# Enable firewall
ufw enable
```

### System Hardening

- Keep the host OS updated
- Use SSH key authentication, disable password auth
- Configure fail2ban for SSH protection
- Regular security updates for Docker and host system

## 💾 Backup Strategy

### Manual Backup

```bash
# Stop services
docker compose -f docker-compose.selfhost.yml stop

# Backup volumes
docker run --rm -v flux-selfhost_flux-vaults:/data/vaults \
  -v flux-selfhost_flux-appdata:/data/appdata \
  -v $(pwd)/backups:/backup \
  alpine tar czf /backup/flux-backup-$(date +%Y%m%d).tar.gz /data

# Restart services
docker compose -f docker-compose.selfhost.yml start
```

### Automated Backup (Cron)

```bash
# Add to crontab (crontab -e)
0 2 * * * cd /path/to/flux && docker compose -f docker-compose.selfhost.yml stop && \
  docker run --rm -v flux-selfhost_flux-vaults:/data/vaults \
  -v flux-selfhost_flux-appdata:/data/appdata \
  -v $(pwd)/backups:/backup \
  alpine tar czf /backup/flux-backup-$(date +\%Y\%m\%d).tar.gz /data && \
  docker compose -f docker-compose.selfhost.yml start
```

### Restore from Backup

```bash
# Stop services
docker compose -f docker-compose.selfhost.yml stop

# Restore volumes
docker run --rm -v flux-selfhost_flux-vaults:/data/vaults \
  -v flux-selfhost_flux-appdata:/data/appdata \
  -v $(pwd)/backups:/backup \
  alpine tar xzf /backup/flux-backup-YYYYMMDD.tar.gz -C /

# Restart services
docker compose -f docker-compose.selfhost.yml start
```

## 🔄 Updates and Maintenance

### Update Flux

```bash
# Pull latest code
git pull

# Rebuild and restart
docker compose -f docker-compose.selfhost.yml up -d --build

# Check status
docker compose -f docker-compose.selfhost.yml ps
sh scripts/check-selfhost.sh
```

### Health Monitoring

```bash
# Check container health
docker compose -f docker-compose.selfhost.yml ps

# View logs
docker compose -f docker-compose.selfhost.yml logs -f

# Check specific service
docker compose -f docker-compose.selfhost.yml logs flux-server
docker compose -f docker-compose.selfhost.yml logs flux-web
```

### Resource Monitoring

```bash
# Container resource usage
docker stats

# Disk usage
docker system df

# Volume usage
docker volume ls
```

## 🔧 Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PUBLIC_URL` | Yes | Your public URL (e.g., `https://flux.example.com`) |
| `FLUX_SETUP_KEY` | Yes* | Initial setup key (remove after setup) |
| `WEB_PORT` | No | Web container port (default: 3000) |
| `FLUX_PLUGIN_REGISTRY_URL` | No | Plugin marketplace URL |
| `FLUX_PLUGIN_REGISTRY_SIGNATURE_URL` | No | Plugin signature verification URL |
| `FLUX_PLUGIN_REGISTRY_PUBLIC_KEY` | No | Plugin marketplace public key |

*Required only for initial setup

### Volume Management

```bash
# List volumes
docker volume ls | grep flux

# Inspect volume
docker volume inspect flux-selfhost_flux-vaults

# Backup volume
docker run --rm -v flux-selfhost_flux-vaults:/data -v $(pwd):/backup \
  alpine tar czf /backup/vaults-backup.tar.gz /data

# Clean up old volumes (CAUTION: deletes data)
docker compose -f docker-compose.selfhost.yml down -v
```

### Resource Limits

Add to `docker-compose.selfhost.yml`:

```yaml
services:
  flux-server:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '0.5'
          memory: 512M
  
  flux-web:
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 1G
        reservations:
          cpus: '0.25'
          memory: 256M
```

## 🐛 Troubleshooting

### Container Won't Start

```bash
# Check logs
docker compose -f docker-compose.selfhost.yml logs flux-server
docker compose -f docker-compose.selfhost.yml logs flux-web

# Validate configuration
docker compose -f docker-compose.selfhost.yml config

# Check disk space
df -h
```

### Setup Key Issues

```bash
# Generate new setup key
openssl rand -hex 32

# Update .env and restart
docker compose -f docker-compose.selfhost.yml restart flux-server
```

### Database Issues

```bash
# Check database file permissions
docker exec flux-server ls -la /data/appdata

# Reset app data (CAUTION: loses settings)
docker compose -f docker-compose.selfhost.yml down
docker volume rm flux-selfhost_flux-appdata
docker compose -f docker-compose.selfhost.yml up -d
```

### Performance Issues

```bash
# Check resource usage
docker stats

# Increase resources in docker-compose.selfhost.yml

# Check database size
docker exec flux-server du -sh /data/appdata
docker exec flux-server du -sh /data/vaults
```

### Network Issues

```bash
# Check container networking
docker network inspect flux-selfhost_flux-internal

# Test connectivity
docker exec flux-web wget -qO- http://flux-server:8080/health
```

## 📊 Monitoring

### Basic Monitoring Script

```bash
#!/bin/bash
# monitor.sh - Basic Flux monitoring

echo "=== Flux Status ==="
docker compose -f docker-compose.selfhost.yml ps

echo -e "\n=== Resource Usage ==="
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"

echo -e "\n=== Disk Usage ==="
df -h | grep -E "Filesystem|/$"

echo -e "\n=== Recent Logs ==="
docker compose -f docker-compose.selfhost.yml logs --tail=10 flux-server
```

### Systemd Service (Optional)

Create `/etc/systemd/system/flux-docker-compose.service`:

```ini
[Unit]
Description=Flux Docker Compose Service
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/path/to/flux
ExecStart=/usr/bin/docker compose -f docker-compose.selfhost.yml up -d
ExecStop=/usr/bin/docker compose -f docker-compose.selfhost.yml down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable flux-docker-compose.service
sudo systemctl start flux-docker-compose.service
```

## 🔍 API Access

### Authentication

Flux uses API tokens for programmatic access:

1. Log in to the web interface
2. Go to Settings → Account
3. Generate an API token
4. Use it in your requests:

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://flux.yourdomain.com/api/v1/status
```

### Endpoints

- `GET /health` - Health check
- `GET /api/v1/status` - System status (authenticated)
- `GET /api/v1/auth/status` - Authentication status
- `POST /api/v1/auth/login` - Login
- `POST /api/v1/auth/logout` - Logout
- `POST /api/v1/auth/tokens` - Create API token
- `DELETE /api/v1/auth/credentials/:id` - Revoke token

## 🚨 Security Best Practices

1. **Never expose ports directly**: Always use HTTPS reverse proxy
2. **Regular updates**: Keep Flux, Docker, and host OS updated
3. **Strong passwords**: Use 15+ character passwords for owner account
4. **Backup regularly**: Automated daily backups recommended
5. **Monitor logs**: Regularly check for suspicious activity
6. **Network isolation**: Keep Flux on private network, expose only via proxy
7. **SSL/TLS**: Always use HTTPS in production
8. **Firewall**: Restrict access to necessary ports only
9. **Least privilege**: Run containers with minimal permissions
10. **Audit**: Regular security audits of configuration and access

## 📝 Advanced Configuration

### Custom SSL Certificates

If you have custom SSL certificates:

```nginx
server {
    listen 443 ssl http2;
    server_name flux.yourdomain.com;
    
    ssl_certificate /etc/ssl/certs/flux.crt;
    ssl_certificate_key /etc/ssl/private/flux.key;
    
    # Strong SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    
    location / {
        proxy_pass http://127.0.0.1:3000;
        # ... other proxy settings
    }
}
```

### Custom Volume Paths

To use custom volume locations:

```yaml
volumes:
  flux-vaults:
    driver: local
    driver_opts:
      type: none
      device: /custom/path/vaults
      o: bind
  
  flux-appdata:
    driver: local
    driver_opts:
      type: none
      device: /custom/path/appdata
      o: bind
```

### Log Rotation

Add to `/etc/logrotate.d/flux-docker`:

```
/var/lib/docker/containers/*flux*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0640 root root
    sharedscripts
    postrotate
        docker compose -f /path/to/flux/docker-compose.selfhost.yml restart > /dev/null
    endscript
}
```

## 🆘 Support

For issues and questions:

- Check existing [GitHub Issues](https://github.com/your-username/flux/issues)
- Review [self-hosting documentation](docs/self-hosting.md)
- Consult [troubleshooting section](#-troubleshooting)

## 📄 License

See the main project LICENSE file for details.

---

**Last Updated**: 2026-09-07  
**Flux Version**: 0.0.2  
**Docker Compose Version**: 2.x
