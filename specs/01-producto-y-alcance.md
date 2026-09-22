# Producto y alcance de Alunza

Estado: **Documentado**, salvo las precisiones expresamente propuestas. Fuentes: F01 ERS §§1–2, F02 Acta y F05 Backlog del [inventario](00-fuentes-y-decisiones.md). Fecha: 2026-09-10.

## Propósito y problema

Alunza ofrece apoyo formativo a estudiantes universitarios que comienzan a programar en JavaScript. Un resultado correcto o incorrecto aislado no explica cómo mejorar; revisar manualmente los intentos de una clase dificulta al profesor detectar errores recurrentes y decidir dónde acompañar.

El producto transforma ejecuciones e intentos en evidencia comprensible. Las pruebas deterministas establecen el resultado técnico. La IA redacta ayuda progresiva basada en material autorizado. El profesor interpreta las señales y decide cualquier intervención.

## Usuarios y responsabilidades

| Actor | Necesidad y capacidad dentro del MVP |
| --- | --- |
| Estudiante | Incorporarse a una clase, resolver ejercicios, ejecutar, enviar, consultar diagnóstico, pedir ayuda, reintentar y ver progreso propio |
| Profesor | Preparar clases, ejercicios, actividades y fuentes; publicar; revisar agregados, intentos y señales de sus clases |
| Administrador de organización | Gobernar organización, identidades, estructura académica, taxonomía, banco, fuentes, reglas y auditoría de su ámbito |
| Docente guía y comisión | Evaluar trazabilidad, reproducibilidad y evidencia de entrega; no implica un rol adicional de aplicación |
| Equipo técnico | Construir, probar y operar la solución con revisión cruzada; tampoco equivale a un rol universal de negocio |

Organización es el ámbito institucional de aislamiento. Curso es la definición académica; clase es la instancia a la que pertenecen profesor y estudiantes. Actividad es una publicación ordenada de ejercicios para una clase. El modelo de datos precisa sus relaciones.

## Flujo completo del MVP

1. El administrador prepara usuarios, cursos y catálogos dentro de su organización.
2. El profesor configura una clase, asigna ejercicios y publica una actividad.
3. El estudiante se incorpora con código vigente, consulta la actividad y programa.
4. Una ejecución controlada muestra resultados de práctica; enviar confirma un intento con verificaciones deterministas y persistencia.
5. El sistema muestra el diagnóstico y ofrece pistas/feedback con fuentes autorizadas. Si falla IA, el intento y su resultado siguen disponibles.
6. Un reintento conserva el historial y puede completar el ejercicio.
7. El progreso y las señales se calculan con reglas reproducibles; el profesor consulta evidencia y registra la revisión de una señal.

## Alcance obligatorio

Los 27 ALZ-RF son **Must** en la ERS. Las prioridades Crítica/Alta del backlog ordenan el trabajo y no convierten requisitos en opcionales.

| Área | Compromiso | Referencias |
| --- | --- | --- |
| Acceso y pertenencia | Sesión, rol, estado ACTIVE, organización, clase e incorporación controlada | RF-001–003 |
| Contenido | Ejercicios versionados, pruebas visibles/ocultas, actividades y material docente | RF-004–006 |
| Práctica | Consulta, editor, ejecución, intento, diagnóstico, pistas, feedback y reintento | RF-007–014 |
| Evidencia | Progreso por actividad/concepto, tablero y detalle estudiantil | RF-015–017 |
| Seguimiento | Tres señales deterministas y revisión sin borrar evidencia | RF-018–019 |
| Gobierno | Organizaciones, usuarios, cursos/clases, taxonomía, banco, fuentes, reglas y CSV operativo | RF-020–027 |

Los identificadores abreviados de esta tabla corresponden a `ALZ-RF-NNN`. La [especificación funcional](02-requisitos-funcionales.md) conserva los identificadores completos.

## Exclusiones

Quedan fuera del MVP: apoderados, LMS completo, aplicación móvil nativa, SSO institucional, pagos, detección automática de plagio o uso de IA, calificación automática de alto impacto y arquitecturas multiagente. Otros lenguajes, asignaturas, notificaciones multicanal e integraciones institucionales avanzadas son evolución futura.

No se requiere un IDE general, instalación libre de paquetes ni ejecución de proyectos arbitrarios. **Propuesta técnica:** acotar los ejercicios a funciones JavaScript cortas con contrato de entrada/salida explícito; ver [ejecutor](13-ejecucion-controlada.md).

## Principios del producto

- El resultado técnico nunca depende de una decisión del LLM.
- Ningún estudiante ve pruebas ocultas, datos ajenos o fuentes fuera de su clase autorizada.
- Cada envío se conserva antes de invocar IA/RAG; un reintento no reemplaza intentos anteriores.
- El progreso muestra numerador, denominador y falta de evidencia; no es una nota.
- Una señal describe una regla y hechos observados; no etiqueta capacidades personales ni aplica sanciones.
- Los errores de servicios externos tienen una salida controlada y no impiden continuar la práctica técnica cuando sus dependencias están disponibles.

## Criterios de éxito y restricciones

| Dimensión | Criterio documentado | Estado |
| --- | --- | --- |
| Cobertura | 27 RF vinculados a HU, CU y PT; flujo completo demostrable | Especificado, sin software acreditado |
| Calidad | Sin defectos conocidos de severidad alta en la versión de entrega | Pendiente de pruebas |
| Rendimiento | p95 interfaz/API <3 s, ejecución completa <5 s e IA <12 s, con perfil documentado | Objetivos no probados |
| Ejecución | 1 vCPU/2 GB de entorno; 128 MB/3 s/64 KB de proceso | Límites definidos, validación pendiente |
| Accesibilidad | WCAG 2.2 AA en funciones principales | Pendiente de evaluación |
| Reproducibilidad | Entorno limpio, datos ficticios y guía verificable | Pendiente de construcción |
| Equipo y calendario | Tres integrantes, 18 semanas, 540 horas; período 11/08–17/12/2026 | Plan documental |
| Presupuesto | CLP 4.585.000 referenciales: 4.320.000 de horas y tope directo de 265.000 | No acredita gasto ejecutado |

La demo debe contener exactamente 2 organizaciones, 2 administradores, 2 profesores, 8 estudiantes, 3 clases, 10 ejercicios y 2 documentos por clase. La distribución y el guion están propuestos en [operación](11-operacion-y-despliegue.md).

No se compromete un porcentaje de mejora del aprendizaje, reducción de carga docente o precisión del LLM sin una evaluación definida. Esos efectos son hipótesis de valor que un piloto posterior deberá medir.

## Organización de la entrega

Marcelo Núñez figura como Product Owner y responsable primario de backend e integración; Benjamin Pérez, de UX/UI, frontend y documentación; Abraham Retamal, de datos, IA/RAG y calidad. Los tres deben aportar implementación, pruebas, documentación y revisión técnica. Fabián Saldaño es el docente guía.

El equipo congela nuevas funciones en semana 15 según la ERS. Los conflictos con la planificación de S7 se registran en DEC-011, sin dar por modificado el cronograma. La [planificación](12-plan-de-entrega.md) define dependencias, hitos y condiciones de terminado.
