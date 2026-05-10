FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY data ./data
EXPOSE 3580
ENV RISCO_IP=127.0.0.1 \
    RISCO_PORT=1000 \
    RISCO_PASSWORD=5678 \
    RISCO_PANEL_ID=0001 \
    RISCO_PANEL_TYPE=LightSys \
    PORT=3580
CMD ["node", "src/server.js"]
