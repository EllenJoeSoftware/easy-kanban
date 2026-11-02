# Mobile app plan

## Today: the PWA
The web app is fully responsive. On a phone you get bottom tabs, swipeable columns with tabs at the top, long-press drag, and full-screen card sheets. Add it to your home screen and it runs like an installed app.

## Later: native app (Expo / React Native)

The design already supports a native app:

| Concern | How it's handled |
|---|---|
| API client | `packages/shared` only needs `fetch`, so you can import `KanbanClient` and the types directly in Expo |
| Auth | Bearer tokens (no cookies), which work the same in React Native |
| Server URL | The client takes a `baseUrl`, so the app can ask for the server address on first launch |
| CORS | `CORS_ORIGINS` lets an Expo web or dev build call the API |
| Realtime | SSE at `/api/events?token=` (use `react-native-sse`, or poll `/dashboard` and `/notifications`) |
| Data shape | Everything the UI shows comes from the API; nothing is rendered on the server |

Suggested steps:

1. `npx create-expo-app apps/mobile` inside this repo and add it to the root `workspaces`.
2. Configure Metro to resolve `@easy-kanban/shared` from `packages/shared/src`.
3. Screens to start with: Login (server URL + credentials), Overview, Board (horizontal `FlatList` of columns with paging), Card sheet, Agents, Notifications.
4. Store the token in `expo-secure-store`.
5. **Push notifications:** add an `expo_push_tokens` table and a `POST /api/devices` endpoint, then send an Expo push from `notify()` in `apps/server/src/events.ts`. That is the single place where every human-facing alert is created.
6. Build and ship with EAS, the same way as EasyPoultry.
