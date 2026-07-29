import {
    characters,
    eventSource,
    event_types,
    getThumbnailUrl,
    saveSettingsDebounced,
} from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import { Popup } from '../../../popup.js';

const MODULE_KEY = 'characterVariantFolders';
const ROOT_ID = 'cvf-root';
const BUTTON_ID = 'cvf-toggle';

const defaults = {
    enabled: false,
    assignments: {},
    folders: [],
    collapsed: {},
};

function settings() {
    extension_settings[MODULE_KEY] = Object.assign({}, defaults, extension_settings[MODULE_KEY]);
    extension_settings[MODULE_KEY].assignments ??= {};
    extension_settings[MODULE_KEY].folders ??= [];
    extension_settings[MODULE_KEY].collapsed ??= {};
    return extension_settings[MODULE_KEY];
}

function characterKey(character) {
    return String(character?.avatar || character?.data?.name || character?.name || '');
}

function creatorNotes(character) {
    return String(character?.data?.creator_notes ?? character?.creatorcomment ?? '').trim();
}

function characterName(character) {
    return String(character?.data?.name ?? character?.name ?? 'Без имени').trim();
}

function automaticFolderName(name) {
    return name
        .replace(/\s*(?:[-–—]\s*)?(?:v(?:er(?:sion)?)?\.?\s*\d+(?:\.\d+)*|rev\.?\s*\d+)\s*$/iu, '')
        .replace(/\s*[\[(（][^\])）]{1,40}[\])）]\s*$/u, '')
        .replace(/\s+(?:alt(?:ernate)?|remake|redux|legacy|new|old)\s*$/iu, '')
        .trim();
}

function buildGroups() {
    const config = settings();
    const explicit = new Map(config.folders.map(name => [name, []]));
    const automatic = new Map();
    const loose = [];

    characters.forEach((character, chid) => {
        const item = { character, chid };
        const assigned = config.assignments[characterKey(character)];
        if (assigned && explicit.has(assigned)) {
            explicit.get(assigned).push(item);
            return;
        }

        const base = automaticFolderName(characterName(character));
        if (!automatic.has(base)) automatic.set(base, []);
        automatic.get(base).push(item);
    });

    const groups = [...explicit.entries()]
        .map(([name, items]) => ({ name, items, explicit: true }))
        .filter(group => group.items.length || config.folders.includes(group.name));

    for (const [name, items] of automatic) {
        if (items.length > 1) {
            groups.push({ name, items, explicit: false });
        } else {
            loose.push(...items);
        }
    }

    groups.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    loose.sort((a, b) => characterName(a.character).localeCompare(characterName(b.character)));
    return { groups, loose };
}

function makeAvatar(item, className = '') {
    const img = document.createElement('img');
    img.className = className;
    img.src = getThumbnailUrl('avatar', item.character.avatar);
    img.alt = characterName(item.character);
    img.loading = 'lazy';
    return img;
}

function folderOptions(selected = '') {
    const fragment = document.createDocumentFragment();
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = 'Без папки (автогруппировка)';
    fragment.append(empty);
    for (const folder of settings().folders) {
        const option = document.createElement('option');
        option.value = folder;
        option.textContent = folder;
        option.selected = folder === selected;
        fragment.append(option);
    }
    return fragment;
}

function openCharacter(chid) {
    const nativeCard = document.querySelector(`#rm_print_characters_block .character_select[chid="${chid}"]`);
    if (nativeCard instanceof HTMLElement) nativeCard.click();
}

function makeVariant(item, managing) {
    const card = document.createElement('article');
    card.className = 'cvf-variant';
    card.dataset.chid = String(item.chid);
    card.append(makeAvatar(item, 'cvf-variant-avatar'));

    const body = document.createElement('div');
    body.className = 'cvf-variant-body';

    const title = document.createElement('div');
    title.className = 'cvf-variant-title';
    title.textContent = characterName(item.character);
    body.append(title);

    const version = item.character?.data?.character_version;
    if (version) {
        const badge = document.createElement('span');
        badge.className = 'cvf-version';
        badge.textContent = `v${version}`;
        title.append(' ', badge);
    }

    const notes = document.createElement('div');
    notes.className = creatorNotes(item.character) ? 'cvf-notes' : 'cvf-notes cvf-notes-empty';
    notes.textContent = creatorNotes(item.character) || 'Примечания от создателя отсутствуют';
    body.append(notes);

    if (managing) {
        const select = document.createElement('select');
        select.className = 'text_pole cvf-folder-select';
        const key = characterKey(item.character);
        select.append(folderOptions(settings().assignments[key]));
        select.addEventListener('click', event => event.stopPropagation());
        select.addEventListener('change', () => {
            if (select.value) settings().assignments[key] = select.value;
            else delete settings().assignments[key];
            saveSettingsDebounced();
            render(true);
        });
        body.append(select);
    }

    card.append(body);
    card.addEventListener('click', () => {
        if (!managing) openCharacter(item.chid);
    });
    return card;
}

function makeFolder(group, managing) {
    const section = document.createElement('section');
    section.className = 'cvf-folder';
    const collapsed = settings().collapsed[group.name] ?? false;
    section.classList.toggle('cvf-collapsed', collapsed);

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'cvf-folder-header';

    const avatars = document.createElement('span');
    avatars.className = 'cvf-folder-avatars';
    group.items.slice(0, 4).forEach(item => avatars.append(makeAvatar(item)));
    if (!group.items.length) {
        const icon = document.createElement('i');
        icon.className = 'fa-solid fa-folder';
        avatars.append(icon);
    }

    const label = document.createElement('span');
    label.className = 'cvf-folder-label';
    const name = document.createElement('strong');
    name.textContent = group.name;
    const count = document.createElement('small');
    count.textContent = `${group.items.length} вариаций${group.explicit ? '' : ' · автоматически'}`;
    label.append(name, count);

    const chevron = document.createElement('i');
    chevron.className = 'fa-solid fa-chevron-down cvf-chevron';
    header.append(avatars, label, chevron);
    header.addEventListener('click', () => {
        settings().collapsed[group.name] = section.classList.toggle('cvf-collapsed');
        saveSettingsDebounced();
    });
    section.append(header);

    const contents = document.createElement('div');
    contents.className = 'cvf-folder-contents';
    group.items.forEach(item => contents.append(makeVariant(item, managing)));
    if (!group.items.length) {
        const empty = document.createElement('div');
        empty.className = 'cvf-empty';
        empty.textContent = 'Папка пуста';
        contents.append(empty);
    }
    section.append(contents);
    return section;
}

async function createFolder() {
    const value = await Popup.show.input('Новая папка персонажа', 'Введите название папки для вариаций:', '');
    const name = typeof value === 'string' ? value.trim() : '';
    if (!name) return;
    if (settings().folders.some(x => x.toLocaleLowerCase() === name.toLocaleLowerCase())) {
        toastr.warning('Папка с таким названием уже существует.');
        return;
    }
    settings().folders.push(name);
    settings().folders.sort((a, b) => a.localeCompare(b));
    saveSettingsDebounced();
    render(true);
}

function makeToolbar(managing, setManaging) {
    const toolbar = document.createElement('div');
    toolbar.className = 'cvf-toolbar';

    const title = document.createElement('strong');
    title.textContent = 'Папки персонажей';

    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'text_pole cvf-search';
    search.placeholder = 'Поиск по папкам, именам и заметкам…';
    search.addEventListener('input', () => applySearch(search.value));

    const manage = document.createElement('button');
    manage.type = 'button';
    manage.className = `menu_button fa-solid ${managing ? 'fa-check' : 'fa-folder-tree'}`;
    manage.title = managing ? 'Завершить сортировку' : 'Распределить персонажей по папкам';
    manage.addEventListener('click', () => setManaging(!managing));

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'menu_button fa-solid fa-folder-plus';
    add.title = 'Создать папку';
    add.addEventListener('click', createFolder);
    toolbar.append(title, search, manage, add);
    return toolbar;
}

function applySearch(query) {
    const normalized = query.trim().toLocaleLowerCase();
    document.querySelectorAll(`#${ROOT_ID} .cvf-folder, #${ROOT_ID} > .cvf-variant`).forEach(element => {
        const matches = !normalized || element.textContent.toLocaleLowerCase().includes(normalized);
        element.classList.toggle('cvf-search-hidden', !matches);
    });
}

let managing = false;
function render(force = false) {
    const config = settings();
    const root = document.getElementById(ROOT_ID);
    const nativeList = document.getElementById('rm_print_characters_block');
    const pagination = document.getElementById('rm_print_characters_pagination');
    if (!root || !nativeList) return;

    root.hidden = !config.enabled;
    nativeList.classList.toggle('cvf-native-hidden', config.enabled);
    pagination?.classList.toggle('cvf-native-hidden', config.enabled);
    document.getElementById(BUTTON_ID)?.classList.toggle('cvf-active', config.enabled);
    if (!config.enabled && !force) return;

    root.replaceChildren();
    root.append(makeToolbar(managing, value => {
        managing = value;
        render(true);
    }));
    const { groups, loose } = buildGroups();
    groups.forEach(group => root.append(makeFolder(group, managing)));
    loose.forEach(item => root.append(makeVariant(item, managing)));

    if (!groups.length && !loose.length) {
        const empty = document.createElement('div');
        empty.className = 'cvf-empty';
        empty.textContent = 'Персонажи не найдены';
        root.append(empty);
    }
}

function toggle() {
    settings().enabled = !settings().enabled;
    saveSettingsDebounced();
    render(true);
}

function mount() {
    if (!document.getElementById(BUTTON_ID)) {
        const button = document.createElement('div');
        button.id = BUTTON_ID;
        button.className = 'menu_button fa-solid fa-folder-tree';
        button.title = 'Папки и вариации персонажей';
        button.addEventListener('click', toggle);
        document.getElementById('rm_buttons_container')?.append(button);
    }

    if (!document.getElementById(ROOT_ID)) {
        const root = document.createElement('div');
        root.id = ROOT_ID;
        root.hidden = true;
        document.getElementById('rm_print_characters_block')?.before(root);
    }
    render(true);
}

export function init() {
    settings();
    mount();
    eventSource.on(event_types.CHARACTER_PAGE_LOADED, () => render());
    eventSource.on(event_types.CHARACTER_EDITED, () => render());
    eventSource.on(event_types.CHARACTER_DELETED, () => render());
}
