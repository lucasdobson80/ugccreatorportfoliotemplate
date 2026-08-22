# The site is plain Node with no dependencies — the only thing it needs from the
# outside world is ffmpeg, for cutting the hero film and transcoding phone clips.
FROM node:22-slim

# ffmpeg cuts the hero film and transcodes phone clips; libheif-examples supplies
# heif-convert for iPhone HEIC photos. Both come from the distro rather than being
# bundled: the macOS ffmpeg binary must not be redistributed, and the browser-side
# HEIC library was LGPL, which has no place inside a paid template.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg libheif-examples ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

# Everything a site owner creates — uploaded photos, clips, the hero frames and
# baked.json — lives under this one directory, which is where the volume mounts.
# Runs as root on purpose: Railway volumes hit permission trouble with non-root images.
RUN mkdir -p /app/assets/user

ENV HOST=0.0.0.0
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.mjs"]
