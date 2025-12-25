import { DOMSubscriber } from "../../dom-subscriber/0.1.0/index.mjs";
import { parseSelectorRequest } from "../../selector-request/0.1.0/index.mjs";
import * as Invokers from "https://unpkg.com/invokers-polyfill@latest/invoker.min.js";

Object.defineProperty(HTMLElement.prototype, "OPTIONS", {
    value: async function() {
        try {
            const headers = new Headers();
            headers.set("Range", `selector=${this.selector}`);
    
            // Use the element's baseURI to support imported nodes
            const url = this.baseURI || window.location.href;
            const response = await fetch(url, {
                headers,
                method: "OPTIONS",
            });
            const allowed = response.headers.get('Allow');
            if ( allowed )
                return allowed.split(',').map( m => m.trim() );
            return [];

        } catch (error) {
            console.error('DOM-aware primitives: OPTIONS request failed:', error);
            const errorEvent = new CustomEvent("DASError", {
                bubbles: true,
                detail: { element: this, error: error, method: 'OPTIONS' },
            });
            this.dispatchEvent(errorEvent);
            throw error;
        }
    }
});

class HTTPCan extends HTMLElement {
    connectedCallback() {
        this.inert = true;
        this._internals = this.attachInternals();
        this._internals.states.add('cannot');

        const method = this.getAttribute('method');
        const selector = this.getAttribute('selector');
        const target = document.querySelector( selector );

        const match = this.constructor[method.toUpperCase()].find( s => {
            return target.matches(s);
        })

        let transitionTo = 'show';
        if (!match) {
            transitionTo = 'hide';
        }

        try {
            const transition = document.startViewTransition( () => this[transitionTo]() )
        } catch(e) {
            this[transitionTo]();
        }
    }

    get can() {

    }

    hide() {
        this.style = 'display: none;';
        this.inert = true;
        this._internals.states.clear();
        this._internals.states.add('cannot');
    }

    show() {
        delete this.style;
        this.style.display = 'inherit';
        this.inert = false;
        this._internals.states.clear();
        this._internals.states.add('can')
    }
}

class HTTPCannot extends HTTPCan {
    hide() {
        super.show();
        this._internals.states.add('can');
    }

    show() {
        super.hide();
        this._internals.states.add('cannot')
    }
}

/*
DOMSubscriber.subscribe(document, '[itemprop]', ( element ) => {
    element.bounce = 0;
    element.addEventListener('blur', (event) => {
        clearTimeout(element.bounce);
        element.bounce = setTimeout(() => {
            event.target.PUT();
        }, 500);            // Handle blur event
    });
})
*/

function serializeContent(content) {
    if (typeof content === 'string') {
        return content;
    } else if (content instanceof HTMLElement) {
        return content.outerHTML;
    } else if (content instanceof DocumentFragment) {
        // Create a temporary div to serialize fragment
        const temp = document.createElement('div');
        temp.appendChild(content.cloneNode(true));
        return temp.innerHTML;
    } else if (content === undefined || content === null) {
        throw new Error('POST requires data to be provided');
    } else {
        throw new Error('POST data must be a string, HTMLElement, or DocumentFragment');
    }
}


function htmlToNode(html) {
    try {
        const template = document.createElement("template");
        template.innerHTML = html.trim();
        const nNodes = template.content.childNodes.length;
        if (nNodes !== 1) {
            throw new Error(
                `html parameter must represent a single node; got ${nNodes}. ` +
                "Note that leading or trailing spaces around an element in your " +
                'HTML, like " <img/> ", get parsed as text nodes neighbouring ' +
                "the element; call .trim() on your input to avoid this."
            );
        }
        return template.content.firstChild;
    } catch (error) {
        console.error('DOM-aware primitives: Failed to parse HTML:', error);
        throw error;
    }
}

function recreateResponse(html, response) {
    const newResponse = new Response(html, {
        status: response.status, // Keep original failure status
        statusText: response.statusText,
        headers: response.headers,
    });
    return newResponse;
}


const processResponse = (anElement, response) => {
    if (response.ok) {
        const evt = new CustomEvent("DASOk", {
            bubbles: true,
            detail: { element: anElement, response: response },
        });
        anElement.dispatchEvent(evt);
    } else {
        const evt = new CustomEvent("DASError", {
            bubbles: true,
            detail: { element: anElement, response: response },
        });
        anElement.dispatchEvent(evt);
    }
    return response;
};

class MultipartBody {
    constructor(body, boundary) {
        this.body = body;
        this.boundary = boundary;
    }

    get parts() {        
        const bits = this.body.split(`--${this.boundary}\r\n`).map( p => p.trim() ).filter( part => part.trim().length > 0 && part.trim() !== '--' );
        bits[bits.length-1] = bits[bits.length-1].replace(new RegExp(`\r\n\r\n--${this.boundary}--$`), '');
        return bits.map( (part) => {
            const lines = part.trim().split('\r\n');
            const headerLines = [];
            for ( const line of lines ) {
                const headerParts = line.split(/:\s/);                
                headerLines.push( headerParts );
            }
            const headers = new Headers( headerLines );
            return headers;
        })
    }
}

const DELETEMethod = async function() {
    try {
        if (!this.parentNode) {
            throw new Error('Element must have a parent to use DELETE');
        }
        
        const headers = new Headers();
        headers.set("Range", `selector=${this.selector}`);
    
        // Use the element's baseURI to support imported nodes
        const url = this.baseURI || window.location.href;
        const response = await fetch(url, {
            headers,
            method: "DELETE",
        });
        if (response.ok) {
            if ( document.startViewTransition ) document.startViewTransition( () => this.remove() );
            else this.remove();
        }
        processResponse( this, response );
    } catch (error) {
        console.error('DOM-aware primitives: DELETE request failed:', error);
        const errorEvent = new CustomEvent("DASError", {
            bubbles: true,
            detail: { element: this, error: error, method: 'DELETE' },
        });
        this.dispatchEvent(errorEvent);
    }
};

const POSTMethod = async function( postData ) {
    try {
        // Serialize the content to HTML string
        const htmlContent = serializeContent(postData).trim();
        
        const headers = new Headers();
        headers.set("Range", `selector=${this.selector}`);
        headers.set("Content-Type", "text/html");
        // Use the element's baseURI to support imported nodes
        const url = this.baseURI || window.location.href;
        const response = await fetch(url, {
            headers,
            body: htmlContent,
            method: "POST",
        });

        // If successful and server returns HTML, append it
        if (
            response.ok &&
            response.headers.get("Content-Type")?.includes("text/html")
        ) {
            const responseHtml = await response.text();
            if (responseHtml) {
                const fixup = () => { 
                    this.appendChild(htmlToNode(responseHtml));
                }
                try {
                    if ( document.startViewTransition ) document.startViewTransition( () => fixup() );
                    else fixup();         
                } catch (domError) {
                    console.error('DOM-aware primitives: Failed to append response HTML:', domError);
                    throw domError;
                }
            }
            return processResponse(this, recreateResponse(responseHtml, response));
        }

        return processResponse(this, response);
    } catch (error) {
        console.error('DOM-aware primitives: POST request failed:', error);
        const errorEvent = new CustomEvent("DASError", {
            bubbles: true,
            detail: { element: this, error: error, method: 'POST' },
        });
        this.dispatchEvent(errorEvent);
        throw error;
    }
};

const PUTMethod = async function() {
    try {
        if (!this.parentNode) {
            throw new Error('Element must have a parent to use PUT');
        }
        
        const headers = new Headers();
        headers.set("Range", `selector=${this.selector}`);
        headers.set("Content-Type", "text/html");

        const clone = this.cloneNode(true);
        let contentEditable = false;
        if ( clone.hasAttribute('contenteditable') ) {
            clone.removeAttribute('contenteditable');
            contentEditable = true;
        }

        // Use the element's baseURI to support imported nodes
        const url = this.baseURI || window.location.href;
        const response = await fetch(url, {
            headers,
            body: clone.outerHTML,
            method: "PUT",
        });
        if (response.ok) {
            if (response.headers.get("Content-Type")?.includes("text/html")) {
                const responseHtml = await response.text();
                if (responseHtml) {
                    try {
                        const newNode = htmlToNode(responseHtml);
                        if ( contentEditable ) newNode.setAttribute('contenteditable', 'plaintext-only');

                        if ( newNode.isEqualNode( this )) {
                            return( this, recreateResponse(responseHtml, response) );
                        }

                        Object.defineProperty(newNode, "PUT", {
                            value: PUTMethod
                         });                                                
                        this.parentNode.replaceChild(newNode, this);                        
                        return processResponse(
                            newNode,
                            recreateResponse(responseHtml, response)
                        );
                    } catch (domError) {
                        console.error('DOM-aware primitives: Failed to replace element:', domError);
                        throw domError;
                    }
                }
            }
        } else {
            // Fallback: try to GET fresh content
            try {
                const getResponse = await this.GET();
                if (getResponse.ok) {
                    const responseHtml = await getResponse.text();
                    if (responseHtml) {
                        const newNode = htmlToNode(responseHtml);
                        this.parentNode.replaceChild(newNode, this);
                        return processResponse(
                            newNode,
                            recreateResponse(responseHtml, response)
                        );
                    }
                }
            } catch (getError) {
                console.error('DOM-aware primitives: PUT fallback GET failed:', getError);
            }
        }
        return processResponse(this, response);
    } catch (error) {
        console.error('DOM-aware primitives: PUT request failed:', error);
        const errorEvent = new CustomEvent("DASError", {
            bubbles: true,
            detail: { element: this, error: error, method: 'PUT' },
        });
        this.dispatchEvent(errorEvent);
        throw error;
    }
};

function processOptionsPart(selector, allowed) {
    if ( allowed.includes('PUT') ) {
        document.querySelectorAll(selector).forEach( ( element ) => {
            element.setAttribute('contenteditable', 'plaintext-only');
            if (Object.hasOwn(element, 'PUT')) return;
            Object.defineProperty(element, "PUT", {
               value: PUTMethod
            });
        });
    }
    if ( allowed.includes('POST') ) {
        document.querySelectorAll(selector).forEach( ( element ) => {
            if (Object.hasOwn(element, 'POST')) return;
            Object.defineProperty(element, "POST", {
                value: POSTMethod
            });
        });                  
    }
    if ( allowed.includes('DELETE') ) {                            
        const handler = ( element ) => {
            if (Object.hasOwn(element, 'DELETE')) return;
            HTTPCan.DELETE.push( selector );
            Object.defineProperty(element, "DELETE", {
                value: DELETEMethod
            });                        
            element.addEventListener('command', async ( event ) => {
                if ( event.command === '--delete' ) {
                    await event.target.DELETE();
                }
            }, { once: true });                        
        };

        DOMSubscriber.subscribe(document, selector, handler);
    }
}

Object.defineProperty(document, 'OPTIONS', {
    value: async function() {
        const response = await fetch(window.location.href, {
            method: 'OPTIONS',
            headers: {
                'Prefer': 'return=representation',
                'Accept': 'multipart/mixed'
            }
        });
        if ( response.ok ) {
            const body = await response.text();            
            if ( response.headers.get('content-type') ) {
                const ctheader = response.headers.get('content-type');
                const boundary = response.headers.get('content-type').match(/boundary=(.+)$/);
                const mpbody = new MultipartBody( body, boundary[1] );
                for ( const part of mpbody.parts ) {
                    if ( part.has('content-range')) {
                        const selector = part.get('content-range').match(/selector=(.+)$/)[1];
                        const allowed = part.get('Allow').split(',').map( m => m.trim() );
                        allowed.forEach( method => {
                            if (!HTTPCan[method]) HTTPCan[method] = [ selector ];
                            else HTTPCan[method].push( selector );
                        });                
                        processOptionsPart(selector, allowed);
                    }
                }
            } else {
                const allow = response.headers.get('Allow');
                if (!allow) return;
                processOptionsPart('html', response.headers.get('Allow').split(',').map( m => m.trim() ) );
            }
        }       
    }
});

(async () => {
    await document.OPTIONS();
    await window.customElements.define('agent-can', HTTPCan);
    await window.customElements.define('agent-cannot', HTTPCannot);
    DOMSubscriber.subscribe(document, '*', async ( element ) => {
        document.OPTIONS();
    }, { ignoreExisting: true } );    
})();

Object.defineProperty(HTMLElement.prototype, "selector", {
    enumerable: false,
    get: function() {
        try {
            // If element has an ID, use it as the selector for stability
            if (this.id) {
                return `#${CSS.escape(this.id)}`;
            }

            // Otherwise, build a path from the nearest parent with an ID
            let el = this;
            let path = [];
            let parent;

            while ((parent = el.parentNode)) {
                // Check if parent is a valid element node
                if (parent.nodeType !== Node.ELEMENT_NODE && parent !== document) {
                    break;
                }
                
                // If parent has an ID, we can start our selector from there
                if (parent.id) {
                    const index = parent.children ? [].indexOf.call(parent.children, el) + 1 : 1;
                    path.unshift(
                        `#${CSS.escape(parent.id)} > ${el.tagName}:nth-child(${index})`
                    );
                    return path.join(" > ").toLowerCase();
                }

                const index = parent.children ? [].indexOf.call(parent.children, el) + 1 : 1;
                path.unshift(
                    `${el.tagName}:nth-child(${index})`
                );
                el = parent;
            }

            return `${path.join(" > ")}`.toLowerCase();
        } catch (error) {
            console.error('DOM-aware primitives: Failed to generate selector:', error);
            // Return a fallback selector
            return `${this.tagName || 'unknown'}`.toLowerCase();
        }
    },
});

function revisedRandId() {
    return Math.random().toString(36).replace(/[^a-z]+/g, '').substr(2, 10);
}

DOMSubscriber.subscribe(document, 'form[action*="#(selector="]', ( form ) => {
    form.addEventListener('submit', async ( event ) => {
        const form = event.target;
        event.preventDefault();
        const sr = parseSelectorRequest( form.getAttribute('action'));
        const target = document.querySelector( sr.selector );
        const template = document.querySelector( target.getAttribute('data-shape') );
        if ( template instanceof HTMLTemplateElement === false ) {
            console.error('Form Submit: Target template not found', { target } );
            return;
        }
        const clone = template.content.cloneNode( true );
        Array.from( form.elements ).filter( input=> input.hasAttribute('name') ).forEach( input => {
            const selector = `[itemprop="${input.getAttribute('name')}"]`;
            const items = clone.querySelectorAll( selector );
            items.forEach( (item) => {
                item.textContent = input.value;
            });

            const generators = clone.querySelectorAll( `[generator\\:generate]` );
            for ( const gen of generators ) {
                const generateAttribute = gen.getAttribute( 'generator:generate' );
                const generatedValue = revisedRandId();
                gen.setAttribute(generateAttribute, generatedValue);
                const generatorAttribute = `generator\\:${generateAttribute}`
                clone.querySelectorAll(`[${generatorAttribute}]`).forEach( (el) => {
                    const setTo = el.getAttribute(`generator:${generateAttribute}`);
                    if ( setTo == 'selector' ) el.setAttribute(setTo, `#${generatedValue}`);
                    else el.setAttribute(setTo, generatedValue);
                    el.removeAttribute(`generator:${generateAttribute}`);
                });
                gen.removeAttribute('generator:generate');
            }
        });
        await target.POST( clone )
        form.reset();
    });
});



HTTPCan.DELETE = [];
HTTPCan.PUT = [];
HTTPCan.POST = [];
