#!/bin/sh
# Lance le serveur de dev Expo. Sur Replit, REPLIT_DEV_DOMAIN est injecte
# automatiquement par la plateforme : on en derive les URLs publiques du
# bundler/API exactement comme avant. En dehors de Replit (self-hosted,
# poste local), ces variables sont absentes -> on ne les fabrique plus a
# partir de "$REPLIT_DEV_DOMAIN" vide (ce qui produisait auparavant des
# URLs "https://" invalides) ; l'appelant est cense avoir deja positionne
# EXPO_PUBLIC_API_URL lui-meme (cf. README / lib/api-config.ts qui echoue
# explicitement sinon, plutot que de fuiter une URL cassee).
if [ -n "$REPLIT_DEV_DOMAIN" ]; then
  export EXPO_PACKAGER_PROXY_URL="https://${REPLIT_EXPO_DEV_DOMAIN:-$REPLIT_DEV_DOMAIN}"
  export EXPO_PUBLIC_API_URL="${EXPO_PUBLIC_API_URL:-https://$REPLIT_DEV_DOMAIN}"
  export EXPO_PUBLIC_DOMAIN="$REPLIT_DEV_DOMAIN"
  export EXPO_PUBLIC_REPL_ID="$REPL_ID"
  export REACT_NATIVE_PACKAGER_HOSTNAME="$REPLIT_DEV_DOMAIN"
fi

exec pnpm exec expo start --localhost --port "${PORT:-8081}"
