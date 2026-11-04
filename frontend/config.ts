// Address of the backend.
// On a phone, "localhost" is the phone itself: put the IP of the PC in .env instead (see README).
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/+$/, '');
