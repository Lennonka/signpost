import { chromeCall } from './chrome-api.js';

export const storageGet = defaults => chromeCall(chrome.storage.local, 'get', defaults);
export const storageSet = data => chromeCall(chrome.storage.local, 'set', data);
export const storageRemove = keys => chromeCall(chrome.storage.local, 'remove', keys);

export function persist(data) {
    return storageSet(data).catch(reportStorageError);
}

export function reportStorageError(error) {
    console.warn('Could not save Signpost data.', error);
}
