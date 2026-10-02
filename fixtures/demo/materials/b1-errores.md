# Leer y explicar errores

Material ficticio de Programación I, clase B1.

Un error de sintaxis impide interpretar el programa. Revisa primero la ubicación señalada y las líneas anteriores: un paréntesis, una comilla o una llave sin cerrar puede desplazar el lugar donde se detecta el problema.

Un error durante la ejecución aparece cuando se intenta realizar una operación que no puede completarse con los valores actuales. Identifica la variable implicada y sigue de dónde provino su valor.

## Diferenciar resultado y ejecución

Que un programa termine sin errores no garantiza que produzca el resultado esperado. Compara el valor retornado con un caso pequeño resuelto previamente. Si difieren, explica los pasos del cálculo antes de cambiar el código.

## Un cambio cada vez

Formula una hipótesis concreta, modifica el paso relacionado y vuelve a comprobar el caso. Conserva los casos que ya funcionaban para detectar regresiones. Si una repetición no termina, revisa cómo cambian los valores que controlan su condición de salida.
