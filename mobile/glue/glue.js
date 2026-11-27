import { Capacitor, registerPlugin } from '@capacitor/core';
import { NodeJS } from 'capacitor-nodejs';

/* Built by scripts/build-www.js into dist/glue.js. The page itself is plain files with no bundler, so this
   is the one place that imports the Capacitor packages and hands them over on window.__dymail.
   DymailBackground is our own plugin (native/DymailBackgroundPlugin.java.tpl), registered in MainActivity. */
const DymailBackground = registerPlugin('DymailBackground');

window.__dymail = { Capacitor, NodeJS, DymailBackground };
