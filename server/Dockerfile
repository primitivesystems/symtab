# Build stage
FROM golang:1.26.6-alpine AS builder

WORKDIR /app

RUN apk --no-cache add build-base

# Copy go mod files
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build the application
RUN CGO_ENABLED=1 GOOS=linux go build -tags sqlite_fts5 -o flux-server .

# Runtime stage
FROM alpine:3.23

RUN apk --no-cache add ca-certificates

RUN addgroup -S flux && adduser -S flux -G flux

RUN mkdir -p /data/vaults /data/appdata && chown -R flux:flux /data

WORKDIR /app

# Copy the binary from builder
COPY --from=builder --chown=flux:flux /app/flux-server .

USER flux

# Expose port
EXPOSE 8080

# Run the binary
CMD ["./flux-server"]
