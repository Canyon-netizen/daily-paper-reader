// Local type declaration for cytoscape-fcose
// 不引 @types/cytoscape-fcose(它没发布到 DefinitelyTyped,装也没用),
// 项目里 fcose 仅作为 cytoscape 的 layout extension 使用,
// 这里声明 default export 是 cytoscape.use() 接受的 (cytoscape: any) => void。

declare module 'cytoscape-fcose' {
  const fcose: (cytoscape: any) => void;
  export default fcose;
}
