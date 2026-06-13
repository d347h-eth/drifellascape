import type { Page, TestInfo } from "playwright/test";

export type PageDiagnostics = {
    consoleMessages: string[];
    pageErrors: string[];
};

export function capturePageDiagnostics(page: Page): PageDiagnostics {
    const consoleMessages: string[] = [];
    const pageErrors: string[] = [];

    page.on("console", (message) => {
        consoleMessages.push(`[${message.type()}] ${message.text()}`);
    });

    page.on("pageerror", (error) => {
        pageErrors.push(error.stack || error.message);
    });

    return { consoleMessages, pageErrors };
}

export async function attachDiagnostics(
    testInfo: TestInfo,
    diagnostics: PageDiagnostics,
): Promise<void> {
    if (diagnostics.consoleMessages.length > 0) {
        await testInfo.attach("browser-console.txt", {
            body: Buffer.from(diagnostics.consoleMessages.join("\n")),
            contentType: "text/plain",
        });
    }

    if (diagnostics.pageErrors.length > 0) {
        await testInfo.attach("page-errors.txt", {
            body: Buffer.from(diagnostics.pageErrors.join("\n\n")),
            contentType: "text/plain",
        });
    }
}
