import { router } from 'expo-router';

/**
 * Close the current modal/screen safely. Falls back to the tab root if there
 * is nothing to go back to, so a modal can never trap the user.
 */
export function closeModal() {
  if (router.canGoBack()) router.back();
  else router.replace('/(tabs)');
}

/** Leave all modals and land on the tabs, then optionally open a screen. */
export function toTabsThen(path?: Parameters<typeof router.push>[0]) {
  try {
    router.dismissAll();
  } catch {
    // no modals to dismiss — already at the root
  }
  if (path) router.push(path);
}
