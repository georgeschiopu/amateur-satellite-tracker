FROM nginx:1.27-alpine

# Replace the default site with our config (listens on 8585)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Static application files
COPY index.html styles.css app.js satellites.js /usr/share/nginx/html/
COPY vendor /usr/share/nginx/html/vendor

EXPOSE 8585

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8585/ || exit 1
