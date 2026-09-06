declare module 'nspell' {
  export interface Nspell {
    correct(word: string): boolean;
    suggest(word: string): string[];
    add(word: string): Nspell;
  }
  function nspell(aff: string, dic: string): Nspell;
  export default nspell;
}
