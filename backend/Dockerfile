FROM golang:1.22-alpine AS builder
RUN apk add --no-cache git
WORKDIR /app
COPY backend/go.mod ./
RUN go mod download || true
COPY backend/ ./
RUN go mod tidy && CGO_ENABLED=0 GOOS=linux go build -o server .

FROM alpine:3.19
RUN apk --no-cache add ca-certificates tzdata
WORKDIR /app
COPY --from=builder /app/server .
EXPOSE 8080
CMD ["./server"]
