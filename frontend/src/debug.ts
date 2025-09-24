export const DEBUG = false;

export function dbg(label: string, data?: any) {
    if (!DEBUG) return;
    if (data === undefined) {
        // eslint-disable-next-line no-console
        console.debug(label);
    } else {
        // eslint-disable-next-line no-console
        console.debug(label, data);
    }
}
