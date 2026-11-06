/**
 * The five signed-in sections of the app.
 *
 * These used to live in components/BottomNav.tsx, next to a bottom bar that was
 * never rendered — the app navigates from the header menu instead. The type
 * stays because App.tsx and the menu are built around it.
 */
export type UserTab = 'home' | 'priority' | 'plans' | 'ai' | 'account'
