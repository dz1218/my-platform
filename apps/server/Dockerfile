FROM golang:1.26-alpine AS build
WORKDIR /src
COPY apps/server/go.mod apps/server/go.sum ./
RUN go mod download
COPY apps/server/ ./
RUN CGO_ENABLED=0 go build -trimpath -o /out/api ./cmd/api && \
    CGO_ENABLED=0 go build -trimpath -o /out/worker ./cmd/worker

FROM alpine:3.22
RUN apk add --no-cache ca-certificates tzdata && adduser -D -u 10001 companion
WORKDIR /app
COPY --from=build /out/ /app/
COPY apps/server/config/ /app/config/
USER companion
ENV SERVER_ADDR=0.0.0.0:8080
EXPOSE 8080
CMD ["/app/api"]
