import {nodeResolve} from '@rollup/plugin-node-resolve';

export default {
    input: 'main.js',
    output: {
        file: '../javascript/lib/codemirror6.bundle.js',
        format: 'iife',
        name: 'CodeMirrorBundle',
        sourcemap: true, // optional, good for debugging
    },
    plugins: [nodeResolve()],
};