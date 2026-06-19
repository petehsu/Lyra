; Supplemental captures for TS/JS grammars whose upstream highlight query is minimal.

(function_declaration name: (identifier) @function)
(method_definition name: (property_identifier) @function.method)
(call_expression function: (identifier) @function)
(string) @string
(template_string) @string
(number) @number