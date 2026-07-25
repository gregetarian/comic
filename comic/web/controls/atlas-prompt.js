/**
 * atlas-prompt.js — "which parcellation is this?", asked only when it cannot be inferred.
 *
 * A bare vector of 400 numbers is equally Schaefer-400 7-network and 17-network. The two disagree
 * about which parcel every element refers to, so guessing produces a figure that looks perfectly
 * plausible and is wrong throughout — the one case where asking is the only honest option.
 *
 * Built from the styles the Presets popup already ships (.preset-pop / .preset-list / .preset-row /
 * .preset-apply), so this adds no CSS and no markup.
 */

/**
 * @param {string[]} candidates atlas keys, best first
 * @param {(k:string)=>string} labelOf human label for a key
 * @param {string} note one line explaining why we are asking
 * @returns {Promise<string|null>} the chosen key, or null if dismissed
 */
export function askAtlas(candidates, labelOf, note) {
    return new Promise((resolve) => {
        const pop = document.createElement('div');
        pop.className = 'preset-pop';
        pop.style.cssText = 'left:50%;top:50%;transform:translate(-50%,-50%);z-index:10001;min-width:260px';

        const head = document.createElement('div');
        head.className = 'preset-saverow';
        head.style.cssText = 'display:block;font-size:11px;color:#444;line-height:1.45';
        head.textContent = note;

        const list = document.createElement('div');
        list.className = 'preset-list';
        for (const key of candidates) {
            const row = document.createElement('div');
            row.className = 'preset-row';
            const b = document.createElement('button');
            b.type = 'button'; b.className = 'preset-apply'; b.textContent = labelOf(key);
            b.addEventListener('click', () => { done(key); });
            row.append(b);
            list.appendChild(row);
        }

        const cancelRow = document.createElement('div');
        cancelRow.className = 'preset-filerow';
        const cancel = document.createElement('button');
        cancel.type = 'button'; cancel.className = 'btn'; cancel.textContent = 'Cancel';
        cancel.addEventListener('click', () => done(null));
        cancelRow.append(cancel);

        pop.append(head, list, cancelRow);
        document.body.appendChild(pop);

        const onKey = (e) => { if (e.key === 'Escape') done(null); };
        window.addEventListener('keydown', onKey);

        function done(value) {
            window.removeEventListener('keydown', onKey);
            pop.remove();
            resolve(value);
        }
    });
}
