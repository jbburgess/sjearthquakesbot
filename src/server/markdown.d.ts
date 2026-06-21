/** Allow importing Markdown templates as raw strings (Vite `?raw`). */
declare module '*.md?raw' {
  const content: string;
  export default content;
}
