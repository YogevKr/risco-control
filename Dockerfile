FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY server.js ui.html ./
EXPOSE 3580
ENV RISCO_IP=192.168.40.199 \
    RISCO_PORT=1000 \
    RISCO_PASSWORD=5678 \
    RISCO_PANEL_ID=0001 \
    RISCO_PANEL_TYPE=LightSys \
    PORT=3580
CMD ["node", "server.js"]
