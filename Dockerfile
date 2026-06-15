# Dell Discovery Canvas — static-file image
# Base: nginx:alpine (multi-arch; includes linux/arm64 for any ARM host).
FROM nginx:1.27-alpine

# apache2-utils provides the `htpasswd` binary used by the optional Basic
# auth entrypoint. ~200KB; nothing else in the image needs it.
RUN apk add --no-cache apache2-utils

# Drop the default site config; we ship our own.
RUN rm /etc/nginx/conf.d/default.conf

# Custom server config: MIME for ESM + AVIF, cache policy, security headers.
COPY nginx.conf /etc/nginx/conf.d/dell-discovery.conf

# Entrypoint hooks (run before nginx starts):
#   40-setup-auth.sh        Optional Basic auth (env: AUTH_USERNAME / AUTH_PASSWORD).
#   45-setup-llm-proxy.sh   Generates the LLM reverse-proxy snippet for the
#                           three providers (env: LLM_HOST / LLM_LOCAL_PORT).
COPY docker-entrypoint.d/40-setup-auth.sh      /docker-entrypoint.d/40-setup-auth.sh
COPY docker-entrypoint.d/45-setup-llm-proxy.sh /docker-entrypoint.d/45-setup-llm-proxy.sh
RUN chmod +x /docker-entrypoint.d/40-setup-auth.sh /docker-entrypoint.d/45-setup-llm-proxy.sh

# Static app payload. Copy whitelist of folders, not '. .', so junk like the
# brace-expansion folder and host-only scripts (start.sh/start.bat) stay out.
#
# IMPORTANT: When adding a new top-level folder (e.g. v3.0's schema/, vendor/),
# add it BOTH to this whitelist AND verify post-build with a real
# browser-smoke check (page renders, not just "tests pass"). Skipping the
# whitelist silently 404s the new folder's modules at runtime.
COPY index.html robots.txt styles.css app.js manifest.json /usr/share/nginx/html/
COPY core/         /usr/share/nginx/html/core/
COPY state/        /usr/share/nginx/html/state/
COPY services/     /usr/share/nginx/html/services/
COPY interactions/ /usr/share/nginx/html/interactions/
COPY ui/           /usr/share/nginx/html/ui/
COPY diagnostics/  /usr/share/nginx/html/diagnostics/
COPY Logo/         /usr/share/nginx/html/Logo/
# v3.0 additions:
COPY schema/       /usr/share/nginx/html/schema/
COPY vendor/       /usr/share/nginx/html/vendor/
COPY catalogs/     /usr/share/nginx/html/catalogs/
COPY selectors/    /usr/share/nginx/html/selectors/
COPY migrations/   /usr/share/nginx/html/migrations/
COPY tests/        /usr/share/nginx/html/tests/

# nginx:alpine already EXPOSEs 80 and runs as root for low ports; keep defaults.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/health || exit 1
