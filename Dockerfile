FROM node:24-alpine

# V databázi jsou všechny časy v UTC, na pražský čas se převádí až při
# zobrazení (src/cas.js). Kontejner proto běží v UTC - formátování na zóně
# stroje nezávisí, ale logy a časy v nich mají být jednoznačné.
# tzdata zůstává: Intl v src/cas.js potřebuje pravidla pro Europe/Prague.
RUN apk add --no-cache tzdata
ENV TZ=UTC

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

# Healthcheck se ptá aplikace, ne jen portu - odpověď obsahuje i dostupnost
# databáze, takže kontejner s nefunkční DB se pozná jako nezdravý.
# Kratší interval a start-period: po nasazení se čeká, až kontejner nahlásí
# healthy, a čekat na první kontrolu půl minuty je zbytečné zdržení.
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
