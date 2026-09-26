# Build stage
FROM golang:1.25-alpine AS builder

WORKDIR /app

RUN apk --no-cache add build-base

# Copy go mod files
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build the application
RUN CGO_ENABLED=1 GOOS=linux go build -tags sqlite_fts5 -o symtab-server ./main.go

# Runtime stage
FROM alpine:3.23

RUN apk --no-cache add ca-certificates

RUN addgroup -S symtab && adduser -S symtab -G symtab

RUN mkdir -p /data/vaults && chown -R symtab:symtab /data

WORKDIR /app

# Copy the binary from builder
COPY --from=builder --chown=symtab:symtab /app/symtab-server .

USER symtab

# Expose port
EXPOSE 8080

# Run the binary
CMD ["./symtab-server"]
