/**
 * `pnpm push:keys`: prints a new VAPID key pair for .env. Keep the private key secret and
 * backed up: changing it invalidates every existing push subscription (browsers must
 * subscribe again), so generate it once per environment.
 */
import webpush from 'web-push';

const { publicKey, privateKey } = webpush.generateVAPIDKeys();
console.log('# Add to .env (never commit the private key):');
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log('VAPID_SUBJECT=mailto:programme-team@example.org  # a real contact push services can reach');
