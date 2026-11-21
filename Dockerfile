# Build the Go service and both webfront frontends without Node, then ship a
# single static binary plus a writable data directory.
FROM golang:1.27-bookworm AS build
WORKDIR /src
ARG VERSION=dev
ARG COMMIT=unknown
ARG BUILT_AT=unknown
ARG GOPROXY=https://proxy.golang.org,direct
ENV GOPROXY=${GOPROXY}
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go tool wf install ./web \
 && go tool wf build -modules ../wf_modules ./web/portal \
 && go tool wf build -mode spa -base /admin -modules ../wf_modules ./web/admin \
 && CGO_ENABLED=0 go build -trimpath \
      -ldflags="-s -w -X olai/internal/version.Version=${VERSION} -X olai/internal/version.Commit=${COMMIT} -X olai/internal/version.BuiltAt=${BUILT_AT}" \
      -o /out/olai .

FROM debian:bookworm-slim
ARG VERSION=dev
ARG COMMIT=unknown
ARG BUILT_AT=unknown
LABEL org.opencontainers.image.title="Olai" \
      org.opencontainers.image.description="Olai AI creation studio" \
      org.opencontainers.image.source="https://github.com/plunjoin/olai" \
      org.opencontainers.image.version=${VERSION} \
      org.opencontainers.image.revision=${COMMIT} \
      org.opencontainers.image.created=${BUILT_AT}
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates tar wget \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --create-home --uid 10001 olai \
 && mkdir -p /app/data \
 && chown -R olai:olai /app
WORKDIR /app
COPY --from=build /out/olai /app/olai
USER olai
ENV HOST=0.0.0.0 PORT=4321
EXPOSE 4321
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-4321}/api/status" > /dev/null || exit 1
ENTRYPOINT ["/app/olai"]
