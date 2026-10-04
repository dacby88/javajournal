const STORAGE_KEY = 'account_names_obfuscated';
const CHANGE_EVENT = 'account-name-obfuscation-change';
let fallbackValue = false;
let storageUnavailable = false;

export function formatAccountName(name: string, obfuscate: boolean): string {
  return obfuscate ? `${Array.from(name).slice(0, 3).join('')}*****` : name;
}

export function getAccountNameObfuscation(): boolean {
  if (storageUnavailable) return fallbackValue;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return fallbackValue;
  }
}

export function setAccountNameObfuscation(value: boolean): void {
  fallbackValue = value;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(value));
    storageUnavailable = false;
  } catch {
    storageUnavailable = true;
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeAccountNameObfuscation(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) {
      storageUnavailable = false;
      listener();
    }
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}
