// Reuses the native Enter sequence verified by the IMP-03 Chrome harness.
export function pressEnterInChrome() {
  // Cypress 16's native Enter omits the character event; its type('{enter}')
  // emits a non-bubbling click, which cannot reach React's delegated listener.
  // Supply the complete native CDP keystroke in this Chrome-only lab harness.
  // https://chromedevtools.github.io/devtools-protocol/tot/Input/#method-dispatchKeyEvent
  cy.then(() =>
    Cypress.automation('remote:debugger:protocol', {
      command: 'Input.dispatchKeyEvent',
      params: {
        type: 'keyDown',
        key: 'Enter',
        code: 'Enter',
        text: '\r',
        unmodifiedText: '\r',
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
      },
    }),
  );
  cy.then(() =>
    Cypress.automation('remote:debugger:protocol', {
      command: 'Input.dispatchKeyEvent',
      params: {
        type: 'keyUp',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
      },
    }),
  );
}
