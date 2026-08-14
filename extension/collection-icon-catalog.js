export const COLLECTION_ICON_ENDPOINT = "https://api.raindrop.io/v1/collections/covers/";
export const COLLECTION_ICON_CACHE_KEY = "private-bookmarks.collection-icon-catalog";
export const COLLECTION_ICON_CACHE_TTL = 24 * 60 * 60 * 1000;

// Compact metadata snapshot from the public catalog; images remain remote and lazy.
const DEFAULT_ICON_GROUPS = [
  ["Colors circle","/collection/templates/colors/","ios1.png,ios10.png,ios11.png,ios2.png,ios3.png,ios4.png,ios5.png,ios6.png,ios7.png,ios8.png,ios9.png,m1.png,m10.png,m11.png,m12.png,m13.png,m14.png,m15.png,m16.png,m17.png,m18.png,m19.png,m2.png,m3.png,m4.png,m5.png,m6.png,m7.png,m8.png,m9.png"],
  ["Flat fun","/collection/templates/bb/","browser.png,calculator.png,calendar.png,contacts.png,folder.png,maps.png,messages.png,music.png,notes.png,photo.png,picture.png,shop.png,time.png,twitter.png"],
  ["Hockey","/collection/templates/hockey-18/","12i.png,13i.png,14i.png,15i.png,16i.png,19i.png,1i.png,21i.png,22i.png,25i.png,2i.png,30i.png,31i.png,32i.png,33i.png,37i.png,39i.png,40i.png,4i.png,5i.png,6i.png,8i.png"],
  ["Landscape","/collection/templates/landscape-15/","i1.png,i10.png,i11.png,i12.png,i13.png,i14.png,i15.png,i16.png,i17.png,i18.png,i19.png,i2.png,i20.png,i21.png,i22.png,i23.png,i24.png,i25.png,i26.png,i27.png,i28.png,i29.png,i3.png,i30.png,i31.png,i32.png,i33.png,i34.png,i35.png,i36.png,i37.png,i38.png,i39.png,i4.png,i40.png,i41.png,i42.png,i43.png,i44.png,i45.png,i46.png,i47.png,i48.png,i49.png,i5.png,i50.png,i6.png,i7.png,i8.png,i9.png"],
  ["Materia Flat Baby vol 2","/collection/templates/materia-flat-baby-vol-2/","i10.png,i19.png,i20.png,i3.png,i5.png,i6.png,i7.png,i8.png"],
  ["Materia Flat Food vol 1","/collection/templates/materia-flat-food-vol-1/","i1.png,i12.png,i13.png,i15.png,i16.png,i19.png,i2.png,i20.png,i22.png,i23.png,i24.png,i25.png,i26.png,i27.png,i28.png,i3.png,i32.png,i33.png,i35.png,i37.png,i39.png,i4.png,i40.png,i41.png,i42.png,i43.png,i44.png,i45.png,i46.png,i47.png,i48.png,i5.png,i50.png,i7.png,i8.png"],
  ["Materia Flat Food vol 2","/collection/templates/materia-flat-food-vol-2/","i1.png,i10.png,i11.png,i12.png,i15.png,i16.png,i17.png,i18.png,i19.png,i2.png,i20.png,i21.png,i22.png,i23.png,i24.png,i25.png,i26.png,i27.png,i6.png,i9.png"],
  ["Materia Flat Halloween free","/collection/templates/materia-flat-halloween-free/","10mfhf.png,11mfhf.png,12mfhf.png,13mfhf.png,14mfhf.png,15mfhf.png,16mfhf.png,17mfhf.png,18mfhf.png,19mfhf.png,1mfhf.png,20mfhf.png,21mfhf.png,22mfhf.png,23mfhf.png,24mfhf.png,25mfhf.png,26mfhf.png,27mfhf.png,28mfhf.png,29mfhf.png,2mfhf.png,30mfhf.png,31mfhf.png,32mfhf.png,33mfhf.png,34mfhf.png,35mfhf.png,36mfhf.png,37mfhf.png,38mfhf.png,39mfhf.png,3mfhf.png,40mfhf.png,41mfhf.png,4mfhf.png,5mfhf.png,6mfhf.png,7mfhf.png,8mfhf.png,9mfhf.png"],
  ["Materia Flat Interior vol 1","/collection/templates/materia-flat-interior-vol-1/","i1.png,i10.png,i11.png,i12.png,i13.png,i14.png,i15.png,i16.png,i17.png,i18.png,i19.png,i2.png,i23.png,i25.png,i26.png,i27.png,i28.png,i29.png,i3.png,i30.png,i31.png,i32.png,i33.png,i34.png,i35.png,i36.png,i37.png,i38.png,i39.png,i4.png,i40.png,i41.png,i43.png,i44.png,i45.png,i47.png,i48.png,i49.png,i5.png,i50.png,i6.png,i7.png,i8.png,i9.png"],
  ["Materia Flat Kitchen vol 1","/collection/templates/materia-flat-kitchen-vol-1/","i1.png,i10.png,i12.png,i13.png,i14.png,i15.png,i2.png,i20.png,i22.png,i23.png,i27.png,i29.png,i3.png,i30.png,i31.png,i32.png,i36.png,i37.png,i38.png,i39.png,i4.png,i40.png,i41.png,i43.png,i44.png,i45.png,i46.png,i49.png,i5.png,i50.png,i6.png,i7.png,i8.png,i9.png"],
  ["Materia Flat Multimedia vol 2","/collection/templates/materia-flat-multimedia-vol-2/","i1.png,i12.png,i13.png,i16.png,i18.png,i19.png,i20.png,i22.png,i26.png,i27.png,i29.png,i3.png,i30.png,i31.png,i32.png,i34.png,i35.png,i36.png,i37.png,i38.png,i4.png,i41.png,i42.png,i43.png,i44.png,i45.png,i46.png"],
  ["Materia Flat Security vol 1","/collection/templates/materia-flat-security-vol-1/","i1.png,i10.png,i11.png,i12.png,i13.png,i14.png,i15.png,i16.png,i17.png,i18.png,i19.png,i2.png,i20.png,i21.png,i22.png,i23.png,i24.png,i29.png,i3.png,i30.png,i31.png,i32.png,i33.png,i34.png,i35.png,i36.png,i37.png,i38.png,i39.png,i40.png,i41.png,i42.png,i43.png,i44.png,i45.png,i46.png,i47.png,i48.png,i49.png,i50.png,i6.png,i7.png,i8.png,i9.png"],
  ["Materia Flat Security vol 2","/collection/templates/materia-flat-security-vol-2/","i1.png,i10.png,i11.png,i12.png,i13.png,i14.png,i15.png,i16.png,i17.png,i18.png,i19.png,i2.png,i20.png,i21.png,i22.png,i23.png,i24.png,i25.png,i26.png,i27.png,i28.png,i29.png,i3.png,i30.png,i31.png,i32.png,i33.png,i34.png,i35.png,i36.png,i37.png,i38.png,i39.png,i4.png,i40.png,i41.png,i42.png,i43.png,i44.png,i45.png,i46.png,i47.png,i48.png,i49.png,i5.png,i7.png,i8.png,i9.png"],
  ["Materia Flat Space","/collection/templates/materia-flat-space/","i1.png,i10.png,i11.png,i12.png,i13.png,i14.png,i15.png,i16.png,i17.png,i18.png,i19.png,i20.png,i22.png,i24.png,i25.png,i26.png,i27.png,i28.png,i3.png,i4.png,i5.png,i6.png,i8.png"],
  ["Materia Flat Transport vol 3","/collection/templates/materia-flat-transport-vol-3/","i1.png,i10.png,i11.png,i12.png,i13.png,i14.png,i15.png,i16.png,i17.png,i18.png,i19.png,i2.png,i21.png,i22.png,i23.png,i24.png,i25.png,i27.png,i3.png,i5.png,i7.png,i8.png,i9.png"],
  ["Mix","/collection/templates/free-1/","12free.png,13free.png,1free.png,2free.png,3free.png,5free.png,6free.png,7free.png,8free.png"],
  ["Round Varieties","/collection/templates/round-varieties/","10rv.png,11rv.png,12rv.png,13rv.png,14rv.png,15rv.png,16rv.png,17rv.png,18rv.png,19rv.png,1rv.png,20rv.png,2rv.png,3rv.png,4rv.png,5rv.png,6rv.png,7rv.png,8rv.png,9rv.png"],
  ["Simple Round","/collection/templates/simple/","airplane.png,apps.png,attantion.png,backpack.png,bag.png,bank.png,baseball.png,basketball.png,bawling.png,billiards.png,cloud.png,compass.png,docs.png,emoney.png,filepsd.png,football.png,mappin.png,moustache.png,raindrop.png,smile.png,star.png,tune.png,tv.png,video.png,xchrome.png,xhtml5.png"],
  ["Smashicons","/collection/templates/aa/","b22.png,b48.png,c10.png,c100.png,c102.png,c103.png,c12.png,c134.png,c15.png,c16.png,c167.png,c2.png,c29.png,c33.png,c46.png,c47.png,c51.png,c58.png,c72.png,c98.png,e10.png,e2.png,e37.png,e38.png,e42.png,e43.png,e5.png,e63.png,e66.png,e67.png,e71.png,e85.png,e86.png,e90.png,e98.png,h1.png,h10.png,h11.png,h12.png,h13.png,h14.png,h15.png,h16.png,h17.png,h18.png,h19.png,h2.png,h20.png,h21.png,h22.png,h23.png,h24.png,h25.png,h26.png,h27.png,h28.png,h29.png,h3.png,h30.png,h31.png,h32.png,h33.png,h34.png,h35.png,h36.png,h37.png,h38.png,h39.png,h4.png,h5.png,h6.png,h7.png,h8.png,h9.png,i40.png,i53.png,i57.png,i59.png,i60.png,j127.png,j155.png,j173.png,j175.png,j185.png,j195.png,j203.png,j204.png,j34.png,k1.png,k10-1.png,k10.png,k11.png,k12.png,k13-1.png,k13.png,k14.png,k15.png,k16.png,k17.png,k18.png,k19.png,k2.png,k20-1.png,k20.png,k21.png,k22.png,k23.png,k24.png,k25.png,k26.png,k27.png,k28.png,k29.png,k3.png,k30.png,k31.png,k32.png,k33.png,k34.png,k35.png,k36.png,k37.png,k38.png,k39.png,k4.png,k40.png,k41.png,k42.png,k43.png,k44.png,k45.png,k46.png,k47.png,k48.png,k49.png,k5.png,k50-1.png,k50.png,k51.png,k52.png,k53.png,k54.png,k55.png,k56.png,k57.png,k58.png,k59.png,k6-1.png,k6.png,k60.png,k61.png,k62.png,k63.png,k64.png,k65.png,k66.png,k67.png,k68.png,k69.png,k7.png,k70.png,k71.png,k72.png,k73.png,k74.png,k75.png,k76.png,k77.png,k78.png,k79.png,k8.png,k80.png,k81.png,k82.png,k83.png,k84.png,k85.png,k86.png,k87.png,k88.png,k89.png,k9-1.png,k9.png,k90.png,k91.png,k92.png,k93.png,l1.png,l103.png,l112.png,l123.png,l129.png,l152.png,l171.png,l192.png,l212.png,l88.png,l93.png,n101.png,n104.png,n127.png,n164.png,n61.png,o11.png,o17.png,o25.png,o26.png,o31.png,o33.png,o37.png,o61.png,o70.png,p12.png,p18.png,p19.png,p25.png,p41.png,p42.png,p52.png,p6.png,p62.png,p64.png,p70.png,q11.png,q14.png,q18.png,q45.png,s22.png,u1.png,u16.png,u17.png,u21.png,u22.png,u31.png,u38.png,u5.png,u56.png,u6.png,u64.png,u68.png,u98.png,v100.png,v102.png,v103.png,v92.png,v93.png,v94.png,v95.png,v96.png,v97.png,v98.png,v99.png,w10.png,w106.png,w112.png,w113.png,w115.png,w119.png,w14.png,w24.png,w25.png,w57.png,w62.png,w65.png,w7.png,w77.png,w78.png,w79.png,w81.png,w84.png,w88.png,w89.png,w98.png"],
  ["Social Flat","/collection/templates/social-media-logos-6/","100social.png,101social.png,102social.png,103social.png,104social.png,105social.png,106social.png,107social.png,108social.png,109social.png,10social.png,110social.png,111social.png,112social.png,113social.png,114social.png,115social.png,116social.png,117social.png,118social.png,119social.png,11social.png,120social.png,121social.png,122social.png,123social.png,124social.png,125social.png,126social.png,127social.png,128social.png,129social.png,12social.png,130social.png,131social.png,132social.png,133social.png,134social.png,135social.png,136social.png,137social.png,138social.png,13social.png,14social.png,15social.png,16social.png,17social.png,18social.png,19social.png,1social.png,20social.png,21social.png,22social.png,23social.png,24social.png,25social.png,26social.png,27social.png,28social.png,29social.png,2social.png,30social.png,31social.png,32social.png,33social.png,34social.png,35social.png,36social.png,37social.png,38social.png,39social.png,3social.png,40social.png,41social.png,42social.png,43social.png,44social.png,45social.png,46social.png,47social.png,48social.png,49social.png,4social.png,50social.png,51social.png,52social.png,53social.png,54social.png,55social.png,56social.png,57social.png,58social.png,59social.png,5social.png,60social.png,61social.png,62social.png,63social.png,64social.png,65social.png,66social.png,67social.png,68social.png,69social.png,6social.png,70social.png,71social.png,72social.png,73social.png,74social.png,75social.png,76social.png,77social.png,78social.png,79social.png,7social.png,80social.png,81social.png,82social.png,83social.png,84social.png,85social.png,86social.png,87social.png,88social.png,89social.png,8social.png,90social.png,91social.png,92social.png,93social.png,94social.png,95social.png,96social.png,97social.png,98social.png,99social.png,9social.png"],
  ["Apple Apps","/collection/templates/apple-apps/","10aa.png,11aa.png,12aa.png,13aa.png,14aa.png,15aa.png,16aa.png,17aa.png,1aa.png,2aa.png,3aa.png,4aa.png,5aa.png,6aa.png,7aa.png,8aa.png,9aa.png"],
  ["Game of Thrones","/collection/templates/game-of-thrones-4/","10got.png,11got.png,12got.png,13got.png,14got.png,15got.png,1got.png,2got.png,3got.png,4got.png,5got.png,6got.png,7got.png,8got.png,9got.png"],
];

export const COLLECTION_ICON_DEFAULT_CATALOG = DEFAULT_ICON_GROUPS.map(([category, path, files]) => ({
  category,
  icons: files.split(",").map((name) => ({ name, url: `https://up.raindrop.io${path}${name}` })),
}));

function iconUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function iconName(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() || "icon");
  } catch {
    return "icon";
  }
}

function catalogGroups(payload) {
  if (Array.isArray(payload)) return payload;
  return payload?.result === true && Array.isArray(payload.items) ? payload.items : [];
}

export function normalizeCollectionIconCatalog(payload) {
  const seen = new Set();
  return catalogGroups(payload).map((group) => {
    const categoryValue = group?.title ?? group?.category;
    const category = typeof categoryValue === "string" ? categoryValue.trim() : "";
    if (!category || !Array.isArray(group?.icons)) return null;
    const icons = group.icons.map((item) => {
      const url = iconUrl(item?.png ?? item?.url);
      if (!url || seen.has(url)) return null;
      seen.add(url);
      return { name: iconName(url), url };
    }).filter(Boolean);
    return icons.length ? { category, icons } : null;
  }).filter(Boolean);
}

export function readCollectionIconCache(storage = globalThis.localStorage, now = Date.now()) {
  if (!storage?.getItem) return null;
  try {
    const entry = JSON.parse(storage.getItem(COLLECTION_ICON_CACHE_KEY) || "null");
    if (!entry || !Number.isFinite(entry.savedAt) || now - entry.savedAt >= COLLECTION_ICON_CACHE_TTL) return null;
    const catalog = normalizeCollectionIconCatalog(entry.items);
    return catalog.length ? catalog : null;
  } catch {
    return null;
  }
}

export function writeCollectionIconCache(storage = globalThis.localStorage, catalog, now = Date.now()) {
  if (!storage?.setItem || !Array.isArray(catalog) || !catalog.length) return false;
  try {
    storage.setItem(COLLECTION_ICON_CACHE_KEY, JSON.stringify({ savedAt: now, items: catalog }));
    return true;
  } catch {
    return false;
  }
}

export async function fetchCollectionIconCatalog(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") throw new TypeError("图标目录不可用");
  const response = await fetchImpl(COLLECTION_ICON_ENDPOINT);
  if (!response?.ok) throw new Error(`图标目录请求失败（${response?.status || 0}）`);
  const catalog = normalizeCollectionIconCatalog(await response.json());
  if (!catalog.length) throw new Error("图标目录无效");
  return catalog;
}
