// Keep lastError handling in the callback, where Chrome makes it available.
export function chromeCall(target, method, ...args) {
    return new Promise((resolve, reject) => {
        target[method](...args, result => {
            const error = chrome.runtime.lastError;
            if (error) reject(new Error(error.message));
            else resolve(result);
        });
    });
}
