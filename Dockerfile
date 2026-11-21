# Build the Go service and both webfront frontends without Node, then ship a
# single static binary plus a writable data directory.
FROM golang:1.27-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go tool wf install ./web \
 && go tool wf build -modules ../wf_modules ./web/portal \
 && go tool wf build -mode spa -base /admin -modules ../wf_modules ./web/admin \
 && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/olai .

FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
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
ENTRYPOINT ["/app/olai"]
