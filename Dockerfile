FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY data ./data
EXPOSE 3580
# Pass the panel access code at run time: -e RISCO_PASSWORD=...
# (no default is baked into the image).
ENV RISCO_IP=127.0.0.1 \
    RISCO_PORT=1000 \
    RISCO_PANEL_ID=0001 \
    RISCO_PANEL_TYPE=LightSys \
    PORT=3580
CMD ["node", "src/server.js"]
