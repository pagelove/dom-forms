import * as DOMForms from 'index.mjs'

DOMSubscriber.subscribe(document, '[itemprop]', ( element ) => {
    element.bounce = 0;
    element.addEventListener('blur', (event) => {
        clearTimeout(element.bounce);
        element.bounce = setTimeout(() => {
            event.target.PUT();
        }, 500);            // Handle blur event
    });
})
