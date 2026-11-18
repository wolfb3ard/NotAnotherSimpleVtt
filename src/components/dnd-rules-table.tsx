export type RulesTable = { name: string; columns: string[]; rows: string[][] };

export function DndRulesTable({ name, columns, rows }: RulesTable) {
  return (
    <div className="dnd-rules-table-scroll" role="region" aria-label={`${name} table`} tabIndex={0}>
      <table className="dnd-rules-table">
        <caption>{name}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, ...cells], index) => (
            <tr key={index}>
              <th scope="row">{label}</th>
              {cells.map((cell, column) => (
                <td key={column}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
