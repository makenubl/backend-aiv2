declare module 'pdf-parse' {
  import type { Buffer } from 'buffer';
  interface PDFData {
    numpages?: number;
    numrender?: number;
    info?: any;
    metadata?: any;
    text: string;
    version?: string;
  }
  function pdf(dataBuffer: Buffer | Uint8Array): Promise<PDFData>;
  export default pdf;
}
