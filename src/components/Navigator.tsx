import { useEffect, useState } from 'react';

const Navigator = () => {
    const [databases, setDatabases] = useState<string[]>([]);
    const [selectedDb, setSelectedDb] = useState<string | null>(null);
    const [tables, setTables] = useState<string[]>([]);
    const [debounceTimeout, setDebounceTimeout] = useState<number | null>(null);
    const [loading, setLoading] = useState(false);
    const [openTable, setOpenTable] = useState<string | null>(null);
    const [tableRows, setTableRows] = useState<any[]>([]);
    const [tableColumns, setTableColumns] = useState<string[]>([]);
    const [visibleColumns, setVisibleColumns] = useState<{ [key: string]: boolean }>({});
    const [rowsLoading, setRowsLoading] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
    const [filters, setFilters] = useState<{ [key: string]: { value: string; operator?: string } }>({});
    const [totalRows, setTotalRows] = useState(0);
    const [totalPages, setTotalPages] = useState(0);
    const rowsPerPage = 20;

    // Fetch databases on mount
    // @param: none
    // @returns: none
    useEffect(() => {
        const fetchDatabases = async () => {
            try {
                const res = await fetch(window.location.hostname === "localhost" ? "http://localhost:5051/api/databases" : "/api/databases");
                const data = await res.json();
                console.log('data:', data);
                const dbNames = data.map((row: any) => Object.values(row)[0]);
                setDatabases(dbNames);
                if (dbNames.length > 0) setSelectedDb(dbNames[0]);
            } catch (error) {
                console.error('Error fetching databases:', error);
            }
        };
        fetchDatabases();
    }, []);

    // Fetch tables when selectedDb changes
    // @param: none
    // @returns: none
    useEffect(() => {
        if (!selectedDb) return;
        try {
            setLoading(true);
            fetch(window.location.hostname === "localhost" ? `http://localhost:5051/api/tableNames/${selectedDb}` : `/api/tableNames/${selectedDb}`)
                .then(res => res.json())
                .then(data => {
                    const tableNames = data.map((row: any) => Object.values(row)[0]);
                    setTables(tableNames);
                    setLoading(false);
                });
        } catch (error) {
            console.error('Error fetching table names:', error);
            setLoading(false);
        }
    }, [selectedDb]);

    // Convert data to CSV format
    // @param: data: any[] - The data to convert
    // @param: columns: string[] - The columns to convert
    // @returns: string - The CSV string
    const convertToCSV = (data: any[] , columns: string[]) => {

        const header = columns.join(',');

        const rows = data.map(row =>
            columns.map(col => {
                const value = row[col] ?? '';
                return typeof value === 'string' && (value.includes(',') || value.includes('"'))
                    ? `"${value.replace(/"/g, '""')}"`
                    : value;
            }).join(',')
        )

        return [header, ...rows].join('\n');
    }

    const handleCSVDownload = () => {
        if (!openTable || !tableRows.length) return;

        const csv = convertToCSV(tableRows, tableColumns.filter(col => visibleColumns[col] ?? true));
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);

        link.setAttribute('href', url);
        link.setAttribute('download', `${openTable}.csv`);
        link.style.visibility = 'hidden';

        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
    // Fetch table data
    // @param: table: string - The name of the table to fetch data from
    // @param: page: number - The page number to fetch
    // @param: sortBy: string - The column to sort by
    // @param: sortDirection: string - The direction to sort by
    // @param: currentFilters: { [key: string]: string } - The current filters
    // @returns: none
    const fetchTableData = async (table: string, page: number, sortBy?: string, sortDirection?: string, currentFilters?: { [key: string]: { value: string; operator?: string } }) => {
        setRowsLoading(true);
        try {
            // Only include non-empty filters
            const activeFilters = Object.entries(currentFilters || filters)
                .filter(([_, filter]) => filter.value.trim() !== '')
                .reduce((acc, [key, filter]) => ({ ...acc, [key]: filter }), {});

            // Build the URL with path parameters
            const baseUrl = window.location.hostname === "localhost" 
                ? `http://localhost:5051/api/rows/${table}/${page}/${rowsPerPage}`
                : `/api/rows/${table}/${page}/${rowsPerPage}`;

            // Build query parameters
            const queryParams = new URLSearchParams();
            if (sortBy) {
                queryParams.append('sortBy', sortBy);
                queryParams.append('sortDirection', sortDirection || 'asc');
            }
            if (Object.keys(activeFilters).length > 0) {
                queryParams.append('filters', JSON.stringify(activeFilters));
            }

            // Construct final URL
            const url = queryParams.toString() 
                ? `${baseUrl}?${queryParams.toString()}`
                : baseUrl;

            console.log('Fetching URL:', url); // Debug log

            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            console.log('Received data:', data); // Debug log
            
            setTableRows(data.rows || []);
            if (data.rows && data.rows.length > 0) {
                setTableColumns(Object.keys(data.rows[0]));
                setTotalRows(data.totalCount || 0);
                setTotalPages(data.totalPages || 0);
            } else {
                //setTableColumns([]);
                setTotalRows(0);
                setTotalPages(0);
            }
            
        } catch (error) {
            console.error('Error fetching table data:', error);
            setTableRows([]);
            //setTableColumns([]);
            setTotalRows(0);
            setTotalPages(0);
        } finally {
            setRowsLoading(false);
        }
    };

    // Handle table click
    // @param: table: string - The name of the table to fetch data from
    // @returns: none
    const handleTableClick = (table: string) => {
        if (openTable === table) {
            setOpenTable(null);
            setTableRows([]);
            setTableColumns([]);
            setCurrentPage(1);
            setSortConfig(null);
            setFilters({});
        } else {
            setOpenTable(table);
            setCurrentPage(1);
            setSortConfig(null);
            setFilters({});
            fetchTableData(table, 1);
        }
    };

    // Handle sort
    // @param: key: string - The column to sort by
    // @returns: none
    const handleSort = (key: string) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
        if (openTable) {
            fetchTableData(openTable, currentPage, key, direction);
        }
    };

    // Handle filter change
    // @param: key: string - The column to filter
    // @param: value: string - The value to filter by
    // @param: operator?: string - The comparison operator for numerical filters
    // @returns: none
    const handleFilterChange = (key: string, value: string, operator?: string) => {
        const newFilters = {...filters, [key]: { value, operator }};
        setFilters(newFilters);

        if (debounceTimeout) {
            clearTimeout(debounceTimeout);
        }

        const timeout = setTimeout(() => {
            setCurrentPage(1);
            if (openTable) {
                fetchTableData(openTable, 1, sortConfig?.key, sortConfig?.direction, newFilters);
            }
        }, 300);

        setDebounceTimeout(timeout);
    };

    // Handle page change
    // @param: newPage: number - The new page number
    // @returns: none
    const handlePageChange = (newPage: number) => {
        setCurrentPage(newPage);
        if (openTable) {
            fetchTableData(openTable, newPage, sortConfig?.key, sortConfig?.direction);
        }
    };

    // Handle column visibility toggle
    const handleColumnVisibilityToggle = (column: string) => {
        setVisibleColumns(prev => ({
            ...prev,
            [column]: !prev[column]
        }));
    };

    // Update visible columns when table columns change
    useEffect(() => {
        if (tableColumns.length > 0) {
            const initialVisibility = tableColumns.reduce((acc, col) => ({
                ...acc,
                [col]: true
            }), {});
            setVisibleColumns(initialVisibility);
        }
    }, [tableColumns]);

    // Check if a column contains numerical values
    const isNumericalColumn = (column: string) => {
        if (!tableRows.length) return false;
        const firstValue = tableRows[0][column];
        return !isNaN(Number(firstValue)) && firstValue !== null && firstValue !== '';
    };

    // Get comparison operators for numerical columns
    const getComparisonOperators = () => [
        { value: '=', label: '=' },
        { value: '>', label: '>' },
        { value: '<', label: '<' },
        { value: '>=', label: '>=' },
        { value: '<=', label: '<=' },
        { value: '!=', label: '!=' }
    ];

    // Handle database change from LLM
    const handleDatabaseChange = (database: string) => {
        if (databases.includes(database)) {
            setSelectedDb(database);
            return true;
        }
        return false;
    };

    // Expose the handler to window for LLM access
    useEffect(() => {
        (window as any).handleDatabaseChange = handleDatabaseChange;
        return () => {
            delete (window as any).handleDatabaseChange;
        };
    }, [databases]);



    return (
        <div>
            <h1>Navigator</h1>
            <div style={{ marginBottom: '1rem' }}>
                <label htmlFor="db-select">Select Database: </label>
                <select
                    id="db-select"
                    value={selectedDb || ''}
                    onChange={e => setSelectedDb(e.target.value)}
                    disabled={databases.length === 0}
                >
                    {databases.map(db => (
                        <option key={db} value={db}>{db}</option>
                    ))}
                </select>
            </div>
            {loading ? (
                <div>Loading tables...</div>
            ) : (
                <div>
                    {tables.map(table => (
                        <div key={table} style={{ marginBottom: '0.5rem', border: '1px solid #222', borderRadius: 4, overflow: 'hidden' }}>
                            <div
                                style={{ fontSize: '1.2rem', background: '#222', color: 'white', padding: '0.5rem', cursor: 'pointer', userSelect: 'none' }}
                                onClick={() => handleTableClick(table)}
                            >
                                {table} {openTable !== table ? '▶' : '▼'}
                            </div>
                            {openTable === table && (
                                <div style={{ padding: '1rem', background: '#f4f4f4' }}>
                                    <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                                            {tableColumns.map(col => (
                                                <label key={col} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' , color: '#222'}}>
                                                    <input
                                                        type="checkbox"
                                                        checked={visibleColumns[col] ?? true}
                                                        onChange={() => handleColumnVisibilityToggle(col)}
                                                    />
                                                    {col}
                                                </label>
                                            ))}
                                        </div>
                                        <button
                                            onClick={handleCSVDownload}
                                            disabled={!tableRows.length || rowsLoading}
                                            style={{
                                                padding: '0.5rem 1rem',
                                                backgroundColor: '#4CAF50',
                                                color: 'white',
                                                border: 'none',
                                                borderRadius: '4px',
                                                cursor: tableRows.length && !rowsLoading ? 'pointer' : 'not-allowed',
                                                opacity: tableRows.length && !rowsLoading ? 1 : 0.6
                                            }}
                                        >
                                            Download CSV
                                        </button>
                                    </div>
                                    <table style={{ color: '#222', width: '100%', borderCollapse: 'collapse', marginBottom: '1rem' }}>
                                        <thead>
                                            <tr>
                                                {tableColumns.filter(col => visibleColumns[col] ?? true).map(col => (
                                                    <th key={col} style={{ border: '1px solid #ccc', padding: '0.25rem', background: '#eee' }}>
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                                            <div 
                                                                style={{ cursor: 'pointer' }}
                                                                onClick={() => handleSort(col)}
                                                            >
                                                                {col} {sortConfig?.key === col && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                                                            </div>
                                                            <div style={{ display: 'flex', gap: '0.25rem' }}>
                                                                {isNumericalColumn(col) && (
                                                                    <select
                                                                        value={filters[col]?.operator || '='}
                                                                        onChange={(e) => handleFilterChange(col, filters[col]?.value || '', e.target.value)}
                                                                        style={{ padding: '0.25rem' }}
                                                                    >
                                                                        {getComparisonOperators().map(op => (
                                                                            <option key={op.value} value={op.value}>{op.label}</option>
                                                                        ))}
                                                                    </select>
                                                                )}
                                                                <input
                                                                    type={isNumericalColumn(col) ? "number" : "text"}
                                                                    placeholder={`Filter ${col}`}
                                                                    value={filters[col]?.value || ''}
                                                                    onChange={(e) => handleFilterChange(col, e.target.value, filters[col]?.operator)}
                                                                    style={{ width: '100%', padding: '0.25rem' }}
                                                                />
                                                            </div>
                                                        </div>
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {rowsLoading ? (
                                                Array(rowsPerPage).fill(null).map((_, idx) => (
                                                    <tr key={`loading-${idx}`}>
                                                        {tableColumns.filter(col => visibleColumns[col] ?? true).map(col => (
                                                            <td key={col} style={{ border: '1px solid #ccc', padding: '0.25rem' }}>
                                                            </td>
                                                        ))}
                                                    </tr>
                                                ))
                                            ) : (
                                                tableRows.map((row, idx) => (
                                                    <tr key={idx}>
                                                        {tableColumns.filter(col => visibleColumns[col] ?? true).map(col => (
                                                            <td key={col} style={{ border: '1px solid #ccc', padding: '0.25rem' }}>
                                                                {String(row[col] ?? '')}
                                                            </td>
                                                        ))}
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                    <div style={{color: '#222', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem' }}>
                                        <div    >
                                            {rowsLoading ? (
                                                'Loading...'
                                            ) : (
                                                `Showing ${((currentPage - 1) * rowsPerPage) + 1} to ${Math.min(currentPage * rowsPerPage, totalRows)} of ${totalRows} rows`
                                            )}
                                        </div>
                                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                                            <button
                                                onClick={() => handlePageChange(currentPage - 1)}
                                                disabled={currentPage === 1 || rowsLoading}
                                                style={{ padding: '0.5rem 1rem', cursor: (currentPage === 1 || rowsLoading) ? 'not-allowed' : 'pointer' }}
                                            >
                                                Previous
                                            </button>
                                            <span style={{ padding: '0.5rem' }}>
                                                Page {currentPage} of {totalPages}
                                            </span>
                                            <button
                                                onClick={() => handlePageChange(currentPage + 1)}
                                                disabled={currentPage === totalPages || rowsLoading}
                                                style={{ padding: '0.5rem 1rem', cursor: (currentPage === totalPages || rowsLoading) ? 'not-allowed' : 'pointer' }}
                                            >
                                                Next
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default Navigator;
